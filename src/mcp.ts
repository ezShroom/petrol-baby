import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'
import { version } from '../package.json'

export class PetrolBabyObject extends McpAgent<Env> {
	server = new McpServer({
		name: 'petrol-baby',
		version
	})

	async init(): Promise<void> {
		const server = this.server as unknown as McpServer

		server.registerTool(
			'say_hello',
			{
				title: 'Greeting Tool',
				description: 'A simple greeting tool',
				inputSchema: {
					name: z.string().min(1).optional()
				},
				outputSchema: {
					response: z.string()
				}
			},
			async ({ name }) => {
				const greeting = name
					? `Hello, ${name}, from Petrol Baby.`
					: 'Hello from Petrol Baby.'

				return {
					content: [
						{
							type: 'text',
							text: greeting
						}
					],
					structuredContent: { response: greeting }
				}
			}
		)
	}
}
