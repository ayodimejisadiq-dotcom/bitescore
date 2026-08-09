// Shared shell for the static pages this project serves.
//
// App Review fetches the Support and Privacy URLs from App Store Connect and
// rejects the app under guideline 1.5 if either errors — so these pages live
// in this repo, deployed with everything else, rather than on a separate site
// that could drift, lapse, or quietly 404.

const CONTACT_EMAIL = 'dimejisadiq@live.com'

export function renderPage(opts: {
  title: string
  heading: string
  subtitle?: string
  body: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 28px; letter-spacing: -0.5px; margin-bottom: 4px; }
  h2 { font-size: 19px; margin-top: 32px; }
  ul { padding-left: 22px; }
  .meta { opacity: 0.6; font-size: 14px; margin-top: 0; }
  a { color: #046A38; }
  nav { margin-top: 48px; padding-top: 16px; border-top: 1px solid rgba(127,127,127,.25);
        font-size: 14px; }
  nav a { margin-right: 16px; }
</style>
</head>
<body>
<h1>${opts.heading}</h1>
${opts.subtitle ? `<p class="meta">${opts.subtitle}</p>` : ''}
${opts.body}
<nav>
  <a href="/">Home</a>
  <a href="/support">Support</a>
  <a href="/privacy">Privacy</a>
  <a href="mailto:${CONTACT_EMAIL}">Contact</a>
</nav>
</body>
</html>
`
}

export { CONTACT_EMAIL }
