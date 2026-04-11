/**
 * Sequential ID assignment for LLM batches.
 *
 * Replaces long hex node IDs with simple 1-indexed integers before
 * sending to the LLM, then restores the real IDs after.
 */

export type IdMapping = {
	/** Map from sequential integer ID to original hex node ID */
	toOriginal: Map<number, string>
	/** Map from original hex node ID to sequential integer ID */
	toSequential: Map<string, number>
}

/**
 * Creates a bidirectional mapping between original node IDs and
 * sequential 1-indexed integers.
 */
export function createIdMapping(nodeIds: string[]): IdMapping {
	const toOriginal = new Map<number, string>()
	const toSequential = new Map<string, number>()

	for (let i = 0; i < nodeIds.length; i++) {
		const id = nodeIds[i]
		if (!id) continue
		const sequential = i + 1
		toOriginal.set(sequential, id)
		toSequential.set(id, sequential)
	}

	return { toOriginal, toSequential }
}

/**
 * Restores the original node ID from a sequential integer ID.
 * Throws if the ID is not found in the mapping.
 */
export function restoreId(mapping: IdMapping, sequentialId: number): string {
	const original = mapping.toOriginal.get(sequentialId)
	if (original === undefined) {
		throw new Error(
			`Sequential ID ${sequentialId} not found in mapping. ` +
				`Valid range: 1-${mapping.toOriginal.size}`
		)
	}
	return original
}
