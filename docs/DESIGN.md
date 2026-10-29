# PAW design notes

[Overview](../README.md) · [한국어 소개](../README.ko.md)

These notes describe the direction agreed on 29 October 2026, with current demo names updated on 30 October. Intended contracts are distinguished from implemented integrations.

## Spaces, tools and records

A Space is a specialist application. Wiki is for knowledge, Yarns for conversations, Office for documents, and Study for reading and learning. A Space can embed another application's reader or editor without taking ownership of its records.

A tool is an operation or reusable interface: a reader, editor, search view or graph. A graph embedded in Wiki need not depend on a running Canvas service. A Yarns reader can appear in Wiki or Forum while Yarns still owns the archived conversation.

An object is a record with a stable identity. Relationships should point to that identity and, when the work depends on an exact source, its revision. Screen position, title and display order are not substitutes for identity.

Core describes the common contracts: identity, relations, provenance, revisions, permissions and events. No shared package, database layout or central service has been selected as the final implementation.

## What each Space owns

This is a vocabulary for discussing boundaries, not a finalized database schema. The application implementation determines the exact record types and supported operations.

| Space | Primary records | Relationships to preserve |
| --- | --- | --- |
| Wiki | Documents, revisions and anchors | Citations, links, categories and document discussions |
| Yarns | Threads, saved revisions, messages and source metadata | Message order, provenance, attachments and the exact source used by derived work |
| Notes | Notes and visual arrangements | Links between notes, graph relationships and references placed on a canvas |
| Office | Working documents and file outputs | Source document, edit operations, output format and the saved version |
| Study | Reading material, reading positions, study notes and vocabulary | Original and translation, page or passage references, and review history |
| Library | Collected outside sources and research records | Original source, collections, analysis and ideas developed from a source |
| Boards | Pins and boards | A pin's source and its placement in one or more collections |
| Forum | Discussions, posts, replies and comments | The object under discussion and any preserved external source |
| Git | Repositories and development projects | Issues, changes, commits and links to project knowledge |
| Studio | Media assets and editing projects | Original media, timeline or edit decisions, and derived outputs |

A Space may be a workspace for a person and a set of tools for an AI in the same session. There is no exclusive split that makes Office “only a tool” or Yarns “only an archive.” Shared tools should follow the same data and permission rules as the visible interface. The current support still has to be checked per application.

## Preserve the source; name the derived work

An archived conversation is a source record. A summary, translation, analysis or edit proposal is derived work. They need separate identities and an explicit relationship to the source used to produce them.

For a conversation reference, the useful boundary is the thread, saved revision and message. A link to the current conversation alone may no longer identify what an earlier analysis saw. The reader should be able to return to the cited source and its context.

Snapshots, caches and backups may hold extra copies. The requirement is to know which record owns the source and which revision a copy represents, rather than to force every application to share one physical copy.

## Boundaries that matter

| Case | Intended behavior |
| --- | --- |
| A conversation appears in Wiki | Yarns retains the archive; Wiki retains the citation and new writing. |
| A Forum discussion quotes a source | Editable posts and replies remain separate from immutable archived messages. |
| A document appears in a repository's wiki tab | It can be a view of the same Wiki document. External GitHub wiki synchronization would be separate work with conflict handling. |
| A project uses several repositories | Project, repository and workspace remain different concepts. |
| AI proposes a change | Record the source and base revision; check access and conflicts before applying it. |
| A diagram represents live records | Keep references to those records rather than treating a drawing as a second database. |

Cross-Space access must respect the source application's permissions. Making a demo public does not make a visitor's private archive public.

## Product scope

Library covers collecting, preserving, organizing, researching and analyzing outside material; it is broader than an image gallery. Boards focuses on pins and visual collections. Forum covers conversation around documents and ideas as well as preserved community sources.

Office currently concentrates on HWP/HWPX. PDF, DOCX, PPTX and XLSX are broader ambitions, not current editing support. Yarns starts with archived AI conversations; voice, transcripts and other conversation sources are later possibilities. Study combines reading, side-by-side material and study records. Studio is a future media-editing Space.

Canvas brings together visual notes, graphs, charts, Mermaid diagrams and workflow views. The current public note app is called Notes; its actual features should determine its description until the broader scope is implemented.

SWU is a separate browser-work tool, not another PAW Space. Direct application APIs and MCP interfaces remain useful where they already provide the needed operation.

## Visual identity

Space icons use a consistent monochrome line style and rounded-square framing, with legibility at 16, 32 and 64 pixels. The agreed motifs are an open book for Wiki, a spool for Yarns, books on a shelf for Library, four tiles for Boards, two speech bubbles for Forum, a branch for Git, a folded document with a cursor for Office, a clapperboard for Studio, two lined documents for Study, and two connected nodes for Canvas.

These are design references, not a claim that every icon or Space has shipped. Existing site identities and storage keys should not change merely to apply a display name.

## First integration to verify

1. Cite a saved Yarns message and revision from a Wiki document.
2. Create an edit proposal based on that document's revision and reject a stale proposal.
3. Produce a document through Office, save it and reopen it to check the result.

Use synthetic examples for the public demonstration. Record which steps ran, what was preserved and what remains unsupported. A name, diagram or link is not evidence that the integration works.
