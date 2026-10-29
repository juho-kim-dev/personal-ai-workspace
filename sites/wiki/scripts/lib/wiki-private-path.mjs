// Windows checks use security descriptors rather than emulated POSIX mode bits.
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
const script = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $p = [IO.Path]::GetFullPath($env:WIKI42_PRIVATE_PATH)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $trustedOwners = @($sid.Value,'S-1-5-18','S-1-5-32-544',([Security.Principal.NTAccount]'NT SERVICE\TrustedInstaller').Translate([Security.Principal.SecurityIdentifier]).Value)
  function CheckComponents([string]$name) {
    while ($name) {
      if ([IO.File]::Exists($name) -or [IO.Directory]::Exists($name)) {
        if (([IO.File]::GetAttributes($name) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
        # Ancestor owners can change DACLs; DELETE/DELETE_CHILD can rebind the path.
        if ($name -ne $p -and [IO.Directory]::Exists($name)) {
          $parentAcl = [IO.Directory]::GetAccessControl($name)
          if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trustedOwners) { throw 'unsafe ancestor owner' }
          foreach ($r in $parentAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544') -and
                ($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
                ($r.FileSystemRights -band ( [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership))) { throw 'unsafe ancestor' }
          }
        }
      }
      $parent = [IO.Path]::GetDirectoryName($name)
      if ($parent -eq $name) { break }; $name = $parent
    }
  }
  CheckComponents $p
  if ($env:WIKI42_PRIVATE_ACTION -eq 'create' -and ![IO.Directory]::Exists($p)) {
    $missing = [Collections.Generic.List[string]]::new()
    $next = $p
    while (![IO.Directory]::Exists($next)) {
      $missing.Add($next); $next = [IO.Path]::GetDirectoryName($next)
    }
    for ($i = $missing.Count - 1; $i -ge 0; $i--) {
      $acl = [Security.AccessControl.DirectorySecurity]::new()
      $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false)
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
      [IO.Directory]::CreateDirectory($missing[$i], $acl) | Out-Null
    }
  }
  CheckComponents $p
  if ($env:WIKI42_PRIVATE_ACTION -eq 'components') { 'OK'; exit 0 }
  $acl = if ([IO.Directory]::Exists($p)) { [IO.Directory]::GetAccessControl($p) } else { [IO.File]::GetAccessControl($p) }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
  $full = $false
  $descendants = $false
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($r.AccessControlType -ne 'Allow' -or $r.IdentityReference.Value -ne $sid.Value) { throw 'foreign or deny rule' }
    if (($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
        ($r.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) {
      $full = $true
      if (($r.InheritanceFlags -band 3) -eq 3 -and $r.PropagationFlags -eq 'None') { $descendants = $true }
    }
  }
  if (!$full) { throw 'missing full control' }
  if ([IO.Directory]::Exists($p) -and (!$acl.AreAccessRulesProtected -or !$descendants)) { throw 'inherited directory ACL' }
  'OK'
} catch { 'UNSAFE'; exit 1 }
`;
export class PrivatePathError extends Error {
  constructor(code) { super('Private local path ownership, permissions or file type is unsafe.'); this.code = code; }
}
function unsafe(code) { throw new PrivatePathError(code); }
function windowsCheck(filename, action, code) {
  const absolute = path.resolve(filename);
  if (!/^[a-z]:\\/i.test(absolute) || absolute.slice(2).includes(':')) unsafe(code);
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) unsafe(code);
  const result = spawnSync(path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, WIKI42_PRIVATE_PATH: absolute, WIKI42_PRIVATE_ACTION: action } });
  if (result.error || result.status !== 0 || result.stdout.trim() !== 'OK') unsafe(code);
}
export function assertPathComponents(filename, code = 'UNSAFE_PATH') {
  if (process.platform === 'win32') windowsCheck(filename, 'components', code);
}
export function assertPrivatePath(filename, info = lstatSync(filename), code = 'UNSAFE_FILE') {
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) unsafe(code);
  if (process.platform === 'win32') windowsCheck(filename, 'check', code);
  else if (info.mode & 0o077) unsafe(code);
}
export function preparePrivateDirectory(directory) {
  if (process.platform === 'win32') windowsCheck(directory, 'create', 'UNSAFE_DIRECTORY');
  else {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertPrivatePath(directory, lstatSync(directory), 'UNSAFE_DIRECTORY');
  }
}

export async function lockWindowsDirectory(directory) {
  // Node owns this exclusive IPC handle, so killing Node also releases the lock.
  const name = '\\\\.\\pipe\\Wiki42Offline-' + createHash('sha256').update(realpathSync.native(directory).toLowerCase()).digest('hex');
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve,reject) => {
    const failed = error => reject(new PrivatePathError(error.code === 'EADDRINUSE' ? 'BUSY' : 'UNSAFE_DIRECTORY'));
    server.once('error', failed);
    server.listen({path:name,exclusive:true,readableAll:false,writableAll:false}, () => {
      server.removeListener('error', failed); resolve();
    });
  });
  return () => new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
}
