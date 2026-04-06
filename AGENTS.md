# petrol.baby

petrol.baby is an MCP that provides agents with information about fuel prices
from the [Fuel Finder Public API](https://www.developer.fuel-finder.service.gov.uk/public-api),
and allows them to easily filter through it in a way that is useful to the
user. We also store 2 days of rolling history.

## General API information

The Fuel Finder API collects data into paginated batches. Each batch is made up
of 500 data points / stations / etc.

## Documentation

- [OAuth endpoints](https://www.developer.fuel-finder.service.gov.uk/apis-ifr/access-token/docs)
- [Data endpoints](https://www.developer.fuel-finder.service.gov.uk/apis-ifr/info-recipent/docs)

## Bun

This project uses Bun as a package manager, and is otherwise built on the
Cloudflare Workers platform.
