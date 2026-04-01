import { DurableObject } from 'cloudflare:workers'

export class PetrolBabyObject extends DurableObject<Env> {
	/*constructor(ctx: DurableObjectState, env: Env) {
		// Required, as we're extending the base class.
		super(ctx, env)
	}*/

	async sayHello(): Promise<string> {
		const result = this.ctx.storage.sql
			.exec("SELECT 'Hello, World!' as greeting")
			.one()
		return result['greeting'] as string
	}
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		const stub = env.PETROL_BABY_OBJECT.getByName(new URL(request.url).pathname)

		const greeting = await stub.sayHello()

		return new Response(greeting)
	}
} satisfies ExportedHandler<Env>
