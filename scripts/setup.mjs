// Creates the git-ignored, environment-specific config files from their
// committed templates. Existing files are never overwritten.
import { copyFileSync, existsSync } from 'node:fs'

const TEMPLATES = [
  ['wrangler.example.jsonc', 'wrangler.jsonc'],
  ['.dev.vars.example', '.dev.vars'],
]

for (const [template, target] of TEMPLATES) {
  if (existsSync(target)) {
    console.log(`kept    ${target}`)
    continue
  }
  copyFileSync(template, target)
  console.log(`created ${target}`)
}
