# Web2MD — AI Agent Coding Rules

These rules govern all code written for this project. Follow them strictly in every phase.

---

## 1. Architecture & Code Organization

- **Single responsibility**: Each file/module handles one concern. Never mix HTTP routing with business logic, or DOM manipulation with data fetching.
- **No god files**: If a file exceeds ~300 lines, refactor into smaller modules.
- **Explicit exports**: Every module must export only what is needed. No `module.exports = { ...everything }`.
- **Consistent naming**:
  - Files: `kebab-case.js`
  - Functions/variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`
  - CSS custom properties: `--category-property` (e.g., `--color-bg-primary`)
- **No circular dependencies**: Module A must not import Module B if B imports A.

---

## 2. Security (Non-Negotiable)

- **Input validation on EVERY route**: Validate and sanitize all user input (URLs, file paths, filenames) before use. Use allowlists, not blocklists.
- **SSRF protection**: Before fetching any URL, resolve it and block requests to:
  - Private IP ranges (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `::1`, `fd00::/8`)
  - `localhost`, `0.0.0.0`
  - Non-HTTP(S) protocols
- **Path traversal protection**: All file paths from the user must be resolved with `path.resolve()` and validated. Block any path containing `..` after resolution. Never blindly join user input with a base path.
- **Filename sanitization**: Strip all special characters from filenames. Use a strict allowlist: `[a-zA-Z0-9._-]`.
- **HTTP security headers**: Set these on every response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:`
  - `X-XSS-Protection: 1; mode=block`
- **Request limits**: Set `express.json({ limit: '1mb' })`. Apply rate limiting consideration for any future public exposure.
- **No `eval()`, `Function()`, or `innerHTML` with unsanitized content**. Ever.
- **Content-type validation**: When downloading images, verify the response `Content-Type` is `image/*` before saving.
- **Atomic file writes**: Write to temp file first, then rename. Never leave partial files on disk.

---

## 3. Error Handling

- **Never swallow errors**: Every `catch` block must either handle the error meaningfully or re-throw it.
- **Structured error responses**: All API errors return JSON: `{ error: { code: "ERROR_CODE", message: "Human-readable message" } }` with appropriate HTTP status codes.
- **Error codes**: Define a consistent set of error codes:
  - `INVALID_URL` (400), `FETCH_FAILED` (502), `CONVERSION_FAILED` (500)
  - `INVALID_PATH` (400), `SAVE_FAILED` (500), `NOT_FOUND` (404)
- **Timeouts**: All external HTTP requests must have explicit timeouts (15s for pages, 10s for images).
- **User-friendly messages**: Never expose stack traces, raw error objects, or internal paths to the frontend. Log the full error server-side, return a clean message to the client.
- **Graceful degradation**: If image download fails, keep the original URL in Markdown and log a warning — don't abort the entire conversion.

---

## 4. Performance

- **No blocking the event loop**: All I/O operations (file reads/writes, HTTP fetches, image downloads) must be async. Never use `fs.readFileSync` or `fs.writeFileSync` in request handlers.
- **Concurrent image downloads**: Use `Promise.allSettled()` with a concurrency limit (max 5 simultaneous). Never fire unlimited parallel requests.
- **Debounce frontend re-renders**: The live Markdown preview must debounce input events (150ms minimum). Never re-render on every keystroke.
- **Minimize DOM operations**: Batch DOM updates. Use `documentFragment` or update `innerHTML` once, not per-element.
- **Lazy loading**: History entries and long lists should load progressively, not all at once.
- **No unnecessary dependencies**: Before adding any npm package, consider if it can be done with Node.js built-in modules. Prefer `node:fs/promises`, `node:path`, `node:url`, `node:crypto` over external packages.
- **Stream large responses**: If a converted Markdown file is very large, stream it rather than buffering in memory.

---

## 5. Frontend — Design & UX

### 5.1 Design System First
- **Always define CSS custom properties (design tokens) before writing component styles.** All colors, fonts, spacing, radii, and shadows must reference tokens, never hardcoded values.
- **Theme support is mandatory**: Every color must have both a dark and light variant. Use `[data-theme="dark"]` and `[data-theme="light"]` selectors on `<html>`.

### 5.2 Visual Quality Standards
- **No browser-default styles**: Override all defaults (buttons, inputs, scrollbars, selections).
- **Typography**: Use Inter from Google Fonts. Minimum body font size: 15px. Use `clamp()` for fluid type scaling.
- **Color palette**: Use HSL-based colors for easy theming. No raw hex values in component styles — only token references.
  - Dark mode base: deep slate/charcoal tones (e.g., `hsl(222, 47%, 11%)`)
  - Light mode base: clean whites with subtle warm tint
  - Accent: violet-to-teal gradient for interactive elements
- **Spacing**: Use a 4px base grid. Define spacing tokens: `--space-xs` through `--space-3xl`.
- **Shadows**: Use layered, realistic box-shadows. At least 2 shadow layers for elevated elements.
- **Border radius**: Consistent radius tokens. Cards: 12-16px. Buttons: 8-10px. Inputs: 8px.

### 5.3 Micro-Animations
- **Every interactive element must have a hover/active state transition** (minimum: opacity or transform change).
- **Button hover**: Slight scale-up (`transform: scale(1.02)`) + shadow elevation.
- **View transitions**: Fade + slight translate when switching views (150ms ease-out).
- **Loading states**: Animated gradient shimmer bar — never a static "Loading..." text.
- **Toast notifications**: Slide-in from bottom-right with fade.
- **All transitions**: Use `cubic-bezier` or `ease-out` timing. Never `linear` for UI animations.

### 5.4 Glassmorphism & Premium Feel
- **Card components**: Semi-transparent backgrounds (`rgba` with `backdrop-filter: blur(12px)`), subtle 1px border with low-opacity white.
- **Input fields**: Inner shadow + subtle border glow on focus (use `box-shadow` with accent color at low opacity).
- **Modals**: Dark overlay (`rgba(0,0,0,0.5)`) + centered glassmorphism card.

### 5.5 Accessibility
- **All interactive elements**: Must be keyboard-navigable (`tabindex`, `:focus-visible` styles).
- **Color contrast**: Meet WCAG AA minimum (4.5:1 for text, 3:1 for large text).
- **ARIA labels**: On icon buttons, modals, dynamic content regions.
- **Focus trapping**: In modals and the directory picker.
- **Reduced motion**: Respect `prefers-reduced-motion: reduce` — disable animations.

---

## 6. Code Quality Standards

- **Comments**: Add JSDoc comments on all exported functions with `@param` and `@returns`. Inline comments only for non-obvious logic — never comment obvious code.
- **Consistent error messages**: Start with what went wrong, then context. E.g., `"Failed to fetch page: connection timed out after 15s"`.
- **No magic numbers**: Extract to named constants. E.g., `const FETCH_TIMEOUT_MS = 15000`.
- **No dead code**: Remove unused variables, functions, imports. Never commit commented-out code.
- **DRY but not over-abstracted**: Extract repeated logic into functions, but don't abstract a pattern until it appears at least 3 times.
- **Use modern JavaScript**: ES modules (`import/export`), `async/await`, optional chaining, nullish coalescing. Set `"type": "module"` in `package.json`.
- **Const by default**: Use `const` always. Only use `let` when reassignment is required. Never use `var`.

---

## 7. Cross-Platform Compatibility

- **File paths**: Always use `path.join()` or `path.resolve()`. Never hardcode `/` or `\\` separators.
- **Line endings**: Output Markdown with `\n` (Unix-style). Let Git handle platform-specific line endings.
- **Home directory**: Use `os.homedir()`, never hardcode `~` or `%USERPROFILE%`.
- **Config storage**: Use `os.homedir()` + `.web2md/` on all platforms.
- **Test path edge cases**: Windows drive letters (`C:\`), UNC paths, paths with spaces.

---

## 8. Phase Discipline

- **Complete one phase fully before starting the next.** Each phase must produce a running, testable application.
- **Verify before proceeding**: Run the server, test the features, confirm no errors in the console before moving on.
- **No forward references**: Code in Phase N must not reference files or functions introduced in Phase N+1.
- **Additive changes only**: Each phase adds to the existing code. Avoid rewriting entire files — use targeted modifications.
- **Keep the app runnable**: At no point should `npm start` fail. If a refactor is needed, do it within the same phase.
