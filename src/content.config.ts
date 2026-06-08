import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const caseStudies = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/case-studies' }),
  schema: z.object({
    title: z.string(),
    client: z.string(),
    date: z.string().or(z.number()).transform(String),
    tags: z.array(z.string()),
    summary: z.string(),
  }),
});

export const collections = { 'case-studies': caseStudies };
