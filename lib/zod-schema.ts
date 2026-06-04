/**
 * Minimal Zod → JSON Schema converter, scoped to the shapes our tool args and
 * LLM output schemas actually use: objects, strings, numbers, booleans, arrays,
 * enums, literals, unions of literals, optional, nullable, and defaults.
 *
 * We deliberately keep this tiny instead of pulling in a heavy dependency; the
 * schemas in this codebase stay within the supported subset.
 */

import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function unwrap(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  optional: boolean;
  nullable: boolean;
  description?: string;
} {
  let inner = schema;
  let optional = false;
  let nullable = false;
  let description = schema._def.description as string | undefined;

  // Peel optional/nullable/default wrappers.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const def = inner._def;
    if (inner instanceof z.ZodOptional) {
      optional = true;
      inner = def.innerType;
    } else if (inner instanceof z.ZodNullable) {
      nullable = true;
      inner = def.innerType;
    } else if (inner instanceof z.ZodDefault) {
      optional = true;
      inner = def.innerType;
    } else if (inner instanceof z.ZodEffects) {
      inner = def.schema;
    } else {
      break;
    }
    description = description ?? (inner._def.description as string | undefined);
  }

  return { inner, optional, nullable, description };
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const { inner, nullable, description } = unwrap(schema);
  let out = convertInner(inner);

  if (nullable && typeof out.type === "string") {
    out = { ...out, type: [out.type as string, "null"] };
  }
  if (description) out.description = description;
  return out;
}

function convertInner(schema: z.ZodTypeAny): JsonSchema {
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };

  if (schema instanceof z.ZodLiteral) {
    return { const: schema._def.value };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema._def.values };
  }

  if (schema instanceof z.ZodNativeEnum) {
    return { enum: Object.values(schema._def.values) };
  }

  if (schema instanceof z.ZodArray) {
    return { type: "array", items: convert(schema._def.type) };
  }

  if (schema instanceof z.ZodUnion) {
    const options = schema._def.options as z.ZodTypeAny[];
    // Union of literals → enum
    if (options.every((o) => o instanceof z.ZodLiteral)) {
      return { enum: options.map((o) => (o as z.ZodLiteral<unknown>)._def.value) };
    }
    return { anyOf: options.map((o) => convert(o)) };
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      const { optional } = unwrap(value);
      if (!optional) required.push(key);
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }

  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: convert(schema._def.valueType) };
  }

  // Fallback — permissive.
  return {};
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}
