// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { z } from 'zod';

const identity = z.string().min(1).max(200);
export const inkResourceTypeSchema = z.enum([
  'pdf',
  'web',
  'image',
  'note',
  'text',
]);
const bindingFields = {
  id: identity,
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  targetNodeId: identity,
  targetType: inkResourceTypeSchema,
  label: z.string().min(1).max(200),
};

export const inkResourceBindingSchema = z.strictObject({
  ...bindingFields,
  strokeIds: z
    .array(identity)
    .length(4)
    .refine((ids) => new Set(ids).size === 4, 'Sigil strokes must be unique'),
});

/** Validate semantic metadata without narrowing unrelated Sketch data or stroke fields. */
export const sketchResourceBindingDataSchema = z
  .object({
    strokes: z
      .array(
        z
          .object({
            resourceBinding: inkResourceBindingSchema.optional(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
  })
  .catchall(z.unknown());

export const inkResourceReferenceSchema = z.strictObject({
  ...bindingFields,
  sourceBounds: z.strictObject({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  sources: z
    .array(z.strictObject({ nodeId: identity, strokeId: identity }))
    .length(4)
    .refine(
      (sources) => new Set(sources.map((source) => source.strokeId)).size === 4,
      'Sigil strokes must be unique',
    ),
});

export const inkResourceReferencesSchema = z
  .array(inkResourceReferenceSchema)
  .max(32)
  .refine(
    (references) =>
      new Set(references.map((reference) => reference.id)).size ===
      references.length,
    'Sigil bindings must be unique',
  );

export type InkResourceBinding = z.infer<typeof inkResourceBindingSchema>;
export type InkResourceReference = z.infer<typeof inkResourceReferenceSchema>;
export type InkResourceType = z.infer<typeof inkResourceTypeSchema>;
