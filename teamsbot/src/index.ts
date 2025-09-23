import { AuthConfiguration, authorizeJWT, CloudAdapter, loadAuthConfigFromEnv, Request } from '@microsoft/agents-hosting'
import express, { Response } from 'express'
import { agentApp } from './agent'

const authConfig: AuthConfiguration = loadAuthConfigFromEnv()
const adapter = new CloudAdapter(authConfig)

const server = express()
server.use(express.json())
server.use(authorizeJWT(authConfig))

server.get('/', (req: Request, res: Response) => {
  res.send('Secure Bot Service Agent is running.')
  return;
})

server.post('/api/messages', async (req: Request, res: Response) => {
  //inspect the request body for /diag
  if (req.body && req.body.type === 'message' && req.body.text === '/diag') {
    console.log('Received /diag request:', req.body)
    console.log('Request headers:', req.headers)
  }
  await adapter.process(req, res, async (context) => {
    const app = agentApp
    await app.run(context)
  })
})

const port = process.env.PORT || 3978
server.listen(port, () => {
  console.log(`\nServer listening to port ${port} for appId ${authConfig.clientId} debug ${process.env.DEBUG}`)
}).on('error', (err) => {
  console.error(err)
  process.exit(1)
})