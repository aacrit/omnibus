// A small JSON Schema validator for the keywords the rights ledger uses:
// $ref (local #/$defs/...), type, const, enum, anyOf, required, properties,
// additionalProperties: false, items, minItems, maxItems, minLength, maxLength,
// pattern, minimum, maximum, exclusiveMinimum, exclusiveMaximum. A keyword it
// does not know is an error, so the schema can never ask for a check this
// file silently skips. Pure; no deps.

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description", "type", "const", "enum", "anyOf", "required",
  "properties", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
]);

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`json-schema: only local refs are supported, got ${ref}`);
  let node = root;
  for (const part of ref.slice(2).split("/")) {
    node = node?.[part];
    if (node === undefined) throw new Error(`json-schema: unresolved ref ${ref}`);
  }
  return node;
}

/** Returns a list of "<json path>: <problem>" strings; empty means valid. */
export function validate(schema, value, root = schema, at = "$") {
  for (const k of Object.keys(schema)) {
    if (!KNOWN.has(k)) throw new Error(`json-schema: unsupported keyword "${k}" at ${at}`);
  }
  if (schema.$ref) return validate(resolveRef(root, schema.$ref), value, root, at);
  const errors = [];
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validate(s, value, root, at).length === 0);
    if (!ok) errors.push(`${at}: matches none of the allowed shapes`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      return [`${at}: expected ${types.join(" or ")}, got ${typeOf(value)}`];
    }
  }
  if ("const" in schema && value !== schema.const) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${at}: must be greater than ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${at}: must be less than ${schema.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${at}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const r of schema.required ?? []) {
      if (!(r in value)) errors.push(`${at}: missing ${r}`);
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errors.push(...validate(props[k], v, root, `${at}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown field ${k}`);
    }
  }
  return errors;
}
