import { json } from '@sveltejs/kit'
import type { RequestHandler } from '@sveltejs/kit'
import { getService } from '$lib/server/service'

/** Liveness: the process is up and the database answers a trivial query. */
export const GET: RequestHandler = () => {
	try {
		const ok = getService().checkHealth()
		if (!ok) throw new Error('database check failed')
		return json({ ok: true, service: 'petrol-baby' })
	} catch (error) {
		console.error('healthz failed:', error)
		return json({ ok: false, service: 'petrol-baby' }, { status: 503 })
	}
}
