export type FuelFinderPrice = {
	fuel_type: string
	price: number
	price_last_updated: string
	price_change_effective_timestamp: string
}

export type FuelFinderStationPrice = {
	node_id: string | null
	public_phone_number: string | null
	trading_name: string
	fuel_prices: FuelFinderPrice[]
}
