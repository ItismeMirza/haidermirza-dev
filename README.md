# haidermirza.dev

Personal site built with Astro + Tailwind CSS. Deploys to GitHub Pages.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:4321

## Adding a case study

Create a new markdown file in `src/content/case-studies/`:

```
touch src/content/case-studies/my-project.md
```

Frontmatter structure:

```
---
layout: ../../layouts/CaseStudy.astro
title: Your Case Study Title
client: Client Name
date: 2024
tags: [Kubernetes, Security, AWS]
summary: One sentence that describes what you solved and why it mattered.
---
```

## Adding logos

Drop PNG files into public/logos/ — expected names:
- f5.png
- doctornow.png
- ima-financial.png
- boeing.png

## Deploying

1. Push repo to GitHub
2. Go to repo Settings > Pages > Source > GitHub Actions
3. Push to main — site builds and deploys automatically

## Custom domain

In repo Settings > Pages > Custom domain, add haidermirza.dev
Then add a CNAME record at your registrar pointing to yourgithubusername.github.io
