export type DayOpeningTime = {
	open: string
	close: string
	is_24_hours: boolean
}

export type OpeningTimes = {
	usual_days: {
		monday: DayOpeningTime
		tuesday: DayOpeningTime
		wednesday: DayOpeningTime
		thursday: DayOpeningTime
		friday: DayOpeningTime
		saturday: DayOpeningTime
		sunday: DayOpeningTime
	}
	bank_holiday: {
		type: string
		open_time: string
		close_time: string
		is_24_hours: boolean
	}
}

export type FuelFinderStation = {
	node_id: string | null
	public_phone_number: string | null
	trading_name: string
	is_same_trading_and_brand_name: boolean
	brand_name: string
	temporary_closure: boolean
	permanent_closure: boolean | null
	permanent_closure_date: string | null
	is_motorway_service_station: boolean
	is_supermarket_service_station: boolean
	location: {
		address_line_1: string
		address_line_2: string | null
		city: string
		country: string
		county: string | null
		postcode: string
		latitude: number
		longitude: number
	}
	amenities: string[]
	opening_times: OpeningTimes
	fuel_types: string[]
}
