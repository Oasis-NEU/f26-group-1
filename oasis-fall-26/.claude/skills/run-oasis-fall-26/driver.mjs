// Headless-Chromium driver for the NUSublet SPA (oasis-fall-26).
//
//   node driver.mjs flow                 # full user journey, PASS/FAIL per step
//   node driver.mjs shot /buildings /seeking ...   # sign in + onboard, screenshot each route
//
// Env: BASE (default http://localhost:5173), OUT (screenshot dir, default $TMPDIR/oasis-shots),
//      PW_DIR (dir where `playwright` is npm-installed, if not resolvable from here).
// Every run signs in anonymously = a brand-new user. Exit code 1 if any step fails
// or any console error / HTTP >= 400 is seen.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  if (!process.env.PW_DIR) throw new Error('playwright not found: set PW_DIR (see SKILL.md Prerequisites)')
  ;({ chromium } = createRequire(resolve(process.env.PW_DIR) + '/')('playwright'))
}

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'oasis-shots'))
mkdirSync(OUT, { recursive: true })
const [mode = 'flow', ...routes] = process.argv.slice(2)

const errors = []
const results = []
let failed = false
let n = 0

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`))

// ui.tsx <Field> wraps its control in a <label>, so find controls by label text.
const field = (label) => page.locator('label', { hasText: label }).locator('input, select, textarea').first()

async function shot(name) {
  const path = `${OUT}/${String(++n).padStart(2, '0')}-${name.replace(/\W+/g, '_').replace(/^_|_$/g, '')}.png`
  await page.screenshot({ path, fullPage: true })
  return path
}

async function step(name, fn) {
  try {
    await fn()
    results.push(`PASS ${name}`)
  } catch (e) {
    failed = true
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`)
  }
  await shot(name)
}

// New anonymous user -> onboarding form -> home. Required before any app route.
async function signInAndOnboard() {
  await page.goto(BASE)
  await page.waitForURL('**/login')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Welcome! Tell us about yourself').waitFor()
  await field('Full name').fill('Test User')
  await field('Northeastern email').fill('test.user@northeastern.edu')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(BASE + '/')
}

if (mode === 'shot') {
  await step('sign in + onboard', signInAndOnboard)
  for (const route of routes.length ? routes : ['/']) {
    await page.goto(BASE + route)
    await page.waitForLoadState('networkidle')
    results.push(`SHOT ${route} -> ${await shot(route)}`)
  }
} else {
  await step('logged-out visitor redirected to /login', async () => {
    await page.goto(BASE)
    await page.waitForURL('**/login')
    await page.getByText('NUSublet').waitFor()
  })

  await step('anonymous sign-in opens onboarding', async () => {
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByText('Welcome! Tell us about yourself').waitFor()
  })

  await step('onboarding rejects non-NEU email', async () => {
    await field('Full name').fill('Test User')
    await field('Northeastern email').fill('test@gmail.com')
    await page.getByRole('button', { name: 'Continue' }).click()
    if (await field('Northeastern email').evaluate((el) => el.checkValidity())) throw new Error('gmail passed validation')
    if (!page.url().endsWith('/profile')) throw new Error('navigated away from /profile')
  })

  await step('onboarding completes', async () => {
    await field('Northeastern email').fill('test.user@northeastern.edu')
    await field('Year').fill('3rd year')
    await field('Major').fill('CS')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL(BASE + '/')
    await page.getByRole('link', { name: 'Listings' }).waitFor()
  })

  await step('listings page shows seed data', async () => {
    await page.waitForLoadState('networkidle')
    const count = await page.locator('a[href^="/listings/"]:not([href="/listings/new"])').count()
    results.push(`  info: ${count} listing cards on /`)
    if (count === 0) throw new Error('no listings rendered')
  })

  await step('create listing', async () => {
    await page.goto(BASE + '/listings/new')
    await field('Title').fill('E2E test room in Fenway')
    await field('Neighborhood').selectOption('Fenway')
    await field('Total bedrooms').fill('3')
    await field('Open rooms').fill('1')
    await field('Rent per room').fill('1200')
    await field('Available from').fill('2027-01-05')
    await field('Available until').fill('2027-06-30')
    await field('Fill by').fill('2026-12-15')
    await field('Description').fill('Smoke test listing.')
    await page.getByRole('button', { name: 'Post listing' }).click()
    await page.waitForURL(/\/listings\/\d+$/)
    await page.getByText('E2E test room in Fenway').first().waitFor()
    results.push(`  info: created ${page.url()}`)
  })

  await step('new listing appears under "Your listings"', async () => {
    await page.goto(BASE + '/')
    await page.getByText('E2E test room in Fenway').first().waitFor()
  })

  await step('create seeker post + see matches', async () => {
    await page.goto(BASE + '/seeking')
    await field('From').fill('2027-01-10')
    await field('Until').fill('2027-06-01')
    await field('Max rent').fill('1500')
    await page.getByRole('button', { name: 'Post', exact: true }).click()
    await page.getByText('Rooms that fit your dates').waitFor()
    await page.waitForLoadState('networkidle')
  })

  await step('buildings list', async () => {
    await page.goto(BASE + '/buildings')
    await page.waitForLoadState('networkidle')
    const count = await page.locator('a[href^="/buildings/"]').count()
    results.push(`  info: ${count} building links`)
    if (count === 0) throw new Error('no buildings rendered')
  })

  await step('building detail', async () => {
    await page.locator('a[href^="/buildings/"]').first().click()
    await page.getByText('Walk to campus').waitFor()
    await page.waitForLoadState('networkidle')
  })

  // Compare: needs seed specs for Back Bay Towers, Fenway Commons and Symphony Place.
  const card = (name) =>
    page.locator('div', { has: page.getByRole('link', { name }) }).filter({ has: page.getByRole('checkbox') }).last()

  await step('compare: tick 2 buildings, tray -> /compare', async () => {
    await page.goto(BASE + '/buildings')
    await card(/Back Bay Towers/).getByRole('checkbox', { name: 'Compare' }).check()
    await page.getByRole('button', { name: 'Pick one more' }).waitFor()
    await card(/Fenway Commons/).getByRole('checkbox', { name: 'Compare' }).check()
    await page.getByText('2 selected').waitFor()
    await page.getByRole('button', { name: 'Compare', exact: true }).click()
    await page.waitForURL(/\/compare\?b=back-bay-towers-sample,fenway-commons-sample$/)
    await page.getByRole('heading', { name: 'Cost' }).waitFor()
    await page.getByText('Unverified').first().waitFor()
    await page.getByRole('link', { name: /City of Boston open data/ }).waitFor()
    const best = await page.locator('.bg-emerald-50').count()
    results.push(`  info: ${await page.locator('[data-row]').count()} rows, ${best} best-value badges`)
    if (best === 0) throw new Error('no best-value highlight')
  })

  await step('compare: show only differences', async () => {
    const before = await page.locator('[data-row]').count()
    await page.getByRole('switch', { name: 'Show only differences' }).click()
    const after = await page.locator('[data-row]').count()
    results.push(`  info: rows ${before} -> ${after}`)
    if (after >= before) throw new Error('no rows hidden')
    await page.getByRole('switch', { name: 'Show only differences' }).click()
  })

  await step('compare: add third building from header', async () => {
    await page.getByRole('combobox', { name: 'Add a building' }).selectOption({ label: 'Symphony Place (sample)' })
    await page.waitForURL(/b=back-bay-towers-sample,fenway-commons-sample,symphony-place-sample$/)
    await page.getByRole('combobox', { name: 'Column 3' }).waitFor()
  })

  await step('compare: 375px wide shows 2 columns, no horizontal scroll', async () => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 0) throw new Error(`page overflows by ${overflow}px`)
    if (await page.getByRole('combobox', { name: 'Column 3' }).isVisible()) throw new Error('3rd column visible on phone')
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  await step('compare: building page links to compare', async () => {
    await page.goto(BASE + '/buildings')
    await page.getByRole('link', { name: /Back Bay Towers/ }).click()
    await page.getByRole('link', { name: 'Compare with other buildings' }).click()
    await page.waitForURL(/\/compare\?b=back-bay-towers-sample$/)
    await page.getByRole('combobox', { name: 'Add a building' }).waitFor()
  })

  await step('profile: save lifestyle', async () => {
    await page.goto(BASE + '/profile')
    await page.getByText('Lifestyle (optional)').waitFor()
    await field('Sleep schedule').selectOption('4')
    await field('Do you smoke?').selectOption('false')
    await page.getByRole('button', { name: 'Save lifestyle' }).click()
    await page.getByText('Saved').waitFor()
  })

  await step('375px wide: no horizontal scroll on /', async () => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(BASE + '/')
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 0) throw new Error(`page overflows by ${overflow}px`)
  })
}

console.log(results.join('\n'))
console.log(`screenshots: ${OUT}`)
if (errors.length) {
  failed = true
  console.log(`\nERRORS:\n${[...new Set(errors)].join('\n')}`)
} else console.log('\nno console/network errors')
await browser.close()
process.exit(failed ? 1 : 0)
