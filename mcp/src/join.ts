// npm run join -- <invite link>: makes the agent account a member of the shared project.
import { signIn } from './client'

const link = process.argv[2]
const token = link?.match(/#\/join\/([\w-]+)/)?.[1] ?? link?.match(/^[0-9a-f-]{36}$/i)?.[0]
if (!token) {
  console.error('Usage: npm run join -- <invite link from Share in the app>')
  process.exit(1)
}

const { db } = await signIn({ keepAlive: false })
const { data: projectId, error } = await db.rpc('join_project', { token })
if (error) {
  console.error(`Could not join: ${error.message}`)
  process.exit(1)
}
const { data: project } = await db.from('projects').select('name').eq('id', projectId).single()
console.log(`Joined "${project?.name ?? projectId}"`)
process.exit(0)
