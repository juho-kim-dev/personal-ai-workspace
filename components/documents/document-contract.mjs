// Browser-safe shared contract. Keep schemas aligned with scripts/document-tools.schema.json.
const revisionProperties = () => ({
  documentId: {type: 'string'},
  expectedRevision: {type: 'string'},
});
const mutationProperties = () => ({
  ...revisionProperties(),
  requestId: {type: 'string', minLength: 1, maxLength: 100},
});
const revisionRequired = ['documentId', 'expectedRevision'];
const mutationRequired = [...revisionRequired, 'requestId'];
const objectSchema = (properties, required) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const schemas = {
  list_documents: objectSchema({}, []),
  get_document: objectSchema({}, []),
  create_document: objectSchema({
    ...mutationProperties(),
    format: {enum: ['hwp', 'hwpx']},
    discardChanges: {type: 'boolean'},
  }, [...mutationRequired]),
  open_document: objectSchema({
    ...mutationProperties(),
    name: {type: 'string', pattern: '\\.(hwp|hwpx)$'},
    bytes: {
      type: 'array', maxItems: 4194304,
      items: {type: 'integer', minimum: 0, maximum: 255},
    },
    discardChanges: {type: 'boolean'},
  }, [...mutationRequired, 'name', 'bytes']),
  batch: objectSchema({
    ...mutationProperties(),
    operations: {
      type: 'array', minItems: 1, maxItems: 100,
      items: objectSchema({
        type: {enum: [
          'insert', 'replace', 'paragraph_break', 'create_table',
          'character_format', 'paragraph_format', 'create_field', 'fill_field',
        ]},
        target: {type: 'string'},
        fieldId: {type: 'integer'},
        name: {type: 'string'},
        guide: {type: 'string'},
        start: {type: 'integer', minimum: 0},
        end: {type: 'integer', minimum: 0},
        text: {type: 'string', maxLength: 100000},
        rows: {type: 'integer', minimum: 1, maximum: 100},
        columns: {type: 'integer', minimum: 1, maximum: 100},
        properties: {type: 'object'},
      }, ['type']),
    },
  }, [...mutationRequired, 'operations']),
  fill_template: objectSchema({
    ...mutationProperties(),
    fields: {type: 'object', additionalProperties: {type: 'string'}},
  }, [...mutationRequired, 'fields']),
  undo: objectSchema(mutationProperties(), [...mutationRequired]),
  redo: objectSchema(mutationProperties(), [...mutationRequired]),
  search: objectSchema({
    ...revisionProperties(), query: {type: 'string', minLength: 1},
  }, [...revisionRequired, 'query']),
  navigate: objectSchema({
    ...revisionProperties(), target: {type: 'string'},
  }, [...revisionRequired, 'target']),
  preview: objectSchema(revisionProperties(), [...revisionRequired]),
  inspect: objectSchema(revisionProperties(), [...revisionRequired]),
  prepare_save: objectSchema({
    ...revisionProperties(),
    format: {enum: ['hwp', 'hwpx']},
    compatibility: {enum: ['preserve', 'hancom-web'], default: 'preserve'},
  }, [...revisionRequired, 'format']),
  save_copy: objectSchema(revisionProperties(), [...revisionRequired]),
};

// name, Korean title, description, readOnlyHint, destructiveHint, idempotentHint.
const descriptions = [
  ['list_documents', '문서 목록', '선택한 로컬 브라우저 세션의 문서와 현재 revision을 조회합니다.', true, false, true],
  ['get_document', '문서 조회', '현재 문서의 식별자, revision, 지원 기능과 구조를 조회합니다.', true, false, true],
  ['create_document', '새 문서', '현재 문서와 revision을 확인한 뒤 새 문서를 만듭니다. 미저장 변경 폐기는 discardChanges로 명시하며 requestId로 재시도를 식별합니다.', false, true, true],
  ['open_document', '문서 열기', '최대 4 MiB의 HWP/HWPX 바이트로 현재 문서를 교체합니다. revision과 requestId가 필요하며 미저장 변경 폐기는 명시해야 합니다.', false, true, true],
  ['batch', '문서 일괄 편집', '현재 지원 범위인 section 0 본문과 직접 셀에 최대 100개 작업을 요청합니다. revision과 requestId가 필요하며 엔진이 지원 범위와 원자성을 검사합니다.', false, true, true],
  ['fill_template', '서식 필드 채우기', '이름별 문자열로 필드를 채웁니다. revision과 requestId를 확인한 뒤 문서를 변경합니다.', false, true, true],
  ['undo', '편집 실행 취소', '구조화 편집 이력을 한 단계 되돌립니다. revision과 requestId가 필요합니다.', false, true, true],
  ['redo', '편집 다시 실행', '취소한 구조화 편집을 다시 적용합니다. revision과 requestId가 필요합니다.', false, true, true],
  ['search', '문서 검색', '지정 revision의 문단에서 비어 있지 않은 문자열을 검색합니다.', true, false, true],
  ['navigate', '문서 위치 이동', 'revision을 확인하고 지원 대상 위치로 브라우저 보기를 이동합니다. 문서 내용은 편집하지 않지만 화면 상태가 바뀝니다.', false, false, true],
  ['preview', '문서 미리보기 측정', '지정 revision의 엔진 레이아웃 측정 결과를 조회합니다. 실제 렌더링 품질 통과를 대신하지 않습니다.', true, false, true],
  ['inspect', '문서 검사', '지정 revision의 엔진 검사 결과와 제한 사항을 조회합니다.', true, false, true],
  ['prepare_save', '저장 사본 준비', 'revision과 형식을 확인하고 저장 사본을 준비·검증합니다. 준비 상태가 변경되며 기본 호환 모드는 preserve입니다.', false, false, false],
  ['save_copy', '저장 사본 받기', '같은 revision에서 검증을 통과한 준비 사본만 요청합니다. 브라우저 다운로드 부수 효과가 있으며 MCP에서는 바이트 대신 읽을 수 있는 리소스 링크를 반환합니다.', false, false, false],
];
function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
export const documentToolDefinitions = freezeTree(descriptions.map(
  ([name, title, description, readOnlyHint, destructiveHint, idempotentHint]) => ({
    name, title, description, inputSchema: schemas[name],
    annotations: {readOnlyHint, destructiveHint, idempotentHint, openWorldHint: false},
  }),
));
const definitionsByName = new Map(documentToolDefinitions.map(tool => [tool.name, tool]));
const MAX_DEPTH = 24;
const MAX_NODES = 4194304 + 100000;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function fail(path, reason) {
  throw new TypeError(`문서 도구 입력 ${path}: ${reason}`);
}
function stringLength(value) {
  let count = 0;
  for (const character of value) count++;
  return count;
}
function childPath(path, key) {
  return `${path}.${String(key).slice(0, 80)}`;
}

// Validates the subset used above, including JSON validity in unconstrained objects.
// No coercion, defaults, input mutation, Node imports, or schema-generated evaluators.
export function validateDocumentToolInput(name, input) {
  const definition = definitionsByName.get(name);
  if (!definition) throw new TypeError('알 수 없는 문서 도구');
  const ancestors = new WeakSet();
  let nodes = 0;
  function visit(value, schema, path, depth) {
    if (depth > MAX_DEPTH) fail(path, '중첩 깊이 제한 초과');
    if (++nodes > MAX_NODES) fail(path, '입력 노드 제한 초과');
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!['null', 'array', 'object', 'string', 'number', 'boolean'].includes(kind)) {
      fail(path, 'JSON 값이 필요합니다');
    }
    if (kind === 'number' && !Number.isFinite(value)) fail(path, '유한한 숫자가 필요합니다');
    if (schema.type === 'integer') {
      if (kind !== 'number' || !Number.isInteger(value)) fail(path, '정수가 필요합니다');
    } else if (schema.type && kind !== schema.type) {
      fail(path, `${schema.type} 형식이 필요합니다`);
    }
    if (schema.enum && !schema.enum.some(candidate => candidate === value)) {
      fail(path, '허용된 열거값이 아닙니다');
    }
    if (kind === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) fail(path, '최솟값 미만');
      if (schema.maximum !== undefined && value > schema.maximum) fail(path, '최댓값 초과');
    }
    if (kind === 'string') {
      if (schema.minLength !== undefined || schema.maxLength !== undefined) {
        const length = stringLength(value);
        if (schema.minLength !== undefined && length < schema.minLength) fail(path, '문자열이 너무 짧습니다');
        if (schema.maxLength !== undefined && length > schema.maxLength) fail(path, '문자열이 너무 깁니다');
      }
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(path, '문자열 패턴 불일치');
    }
    if (kind !== 'object' && kind !== 'array') return;
    if (ancestors.has(value)) fail(path, '순환 참조는 JSON이 아닙니다');
    ancestors.add(value);
    try {
      if (kind === 'array') {
        if (Object.getPrototypeOf(value) !== Array.prototype) fail(path, '일반 JSON 배열이 필요합니다');
        if (schema.minItems !== undefined && value.length < schema.minItems) fail(path, '배열이 너무 짧습니다');
        if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(path, '배열이 너무 깁니다');
        if (Object.getOwnPropertySymbols(value).length || hasOwn(value, 'toJSON')) fail(path, 'JSON 배열만 허용합니다');
        for (const key in value) {
          const index = Number(key);
          if (!hasOwn(value, key) || !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
            fail(path, '배열의 추가 속성은 허용하지 않습니다');
          }
        }
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(path, '빈 슬롯·접근자 배열은 허용하지 않습니다');
          visit(descriptor.value, schema.items ?? {}, `${path}[${index}]`, depth + 1);
        }
        return;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) fail(path, '일반 JSON 객체가 필요합니다');
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) {
        if (!hasOwn(value, key)) fail(childPath(path, key), '필수 속성 누락');
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') fail(path, '심볼 속성은 JSON이 아닙니다');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(path, '접근자·숨김 속성은 허용하지 않습니다');
        const known = hasOwn(properties, key);
        if (!known && schema.additionalProperties === false) fail(childPath(path, key), '추가 속성 금지');
        const childSchema = known ? properties[key]
          : schema.additionalProperties && typeof schema.additionalProperties === 'object'
            ? schema.additionalProperties : {};
        visit(descriptor.value, childSchema, childPath(path, key), depth + 1);
      }
    } finally {
      ancestors.delete(value);
    }
  }
  visit(input, definition.inputSchema, '$', 0);
  return input;
}
