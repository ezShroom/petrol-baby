const a = await fetch(
  "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.FUEL_FINDER_CLIENT_ID,
      client_secret: process.env.FUEL_FINDER_CLIENT_SECRET,
    }),
  }
);
console.log(await a.json());
