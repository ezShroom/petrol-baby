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
	opening_times: {
		usual_days: {
			monday: {
				open: string
				close: string
				is_24_hours: boolean
			}
			tuesday: {
				open: string
				close: string
				is_24_hours: boolean
			}
			wednesday: {
				open: string
				close: string
				is_24_hours: boolean
			}
			thursday: {
				open: string
				close: string
				is_24_hours: boolean
			}
			friday: {
				open: string
				close: string
				is_24_hours: boolean
			}
			saturday: {
				open: string
				close: string
				is_24_hours: boolean
			}
			sunday: {
				open: string
				close: string
				is_24_hours: boolean
			}
		}
		bank_holiday: {
			type: string
			open_time: string
			close_time: string
			is_24_hours: boolean
		}
	}
	fuel_types: string[]
}
