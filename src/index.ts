import { App } from './app.js'

async function main() {
  const app = new App()
  await app.start()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
