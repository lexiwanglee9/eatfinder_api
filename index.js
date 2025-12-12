require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PORT = process.env.PORT || 3000;

// 計算距離（Haversine）
function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半徑 KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI/180) *
    Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Mapping budget → price level
function mapBudgetToPriceLevel(budget) {
  if (budget < 200) return { minPrice: 0, maxPrice: 1 };
  if (budget < 400) return { minPrice: 1, maxPrice: 2 };
  if (budget < 800) return { minPrice: 2, maxPrice: 3 };
  return { minPrice: 3, maxPrice: 4 };
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/restaurants", async (req, res) => {
  try {
    const { category, regionText, budgetPerPerson } = req.body;

    //
    // Step 1. Geocode 地區 → 中心座標
    //
    const geoUrl = 
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        regionText
      )}&key=${GOOGLE_API_KEY}`;

    const geoData = await (await fetch(geoUrl)).json();
    if (!geoData.results.length) return res.json([]);

    const center = geoData.results[0].geometry.location;

    //
    // Step 2. Nearby 搜尋
    //
    const { minPrice, maxPrice } = mapBudgetToPriceLevel(budgetPerPerson);

    const placesUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    );
    placesUrl.searchParams.set("key", GOOGLE_API_KEY);
    placesUrl.searchParams.set("location", `${center.lat},${center.lng}`);
    placesUrl.searchParams.set("radius", "2000");
    placesUrl.searchParams.set("type", "restaurant");
    placesUrl.searchParams.set("keyword", category);
    placesUrl.searchParams.set("minprice", minPrice);
    placesUrl.searchParams.set("maxprice", maxPrice);

    const placesData = await (await fetch(placesUrl)).json();
    const items = placesData.results.slice(0, 15);

    //
    // Step 3. 拿詳細資料（電話 / 開放時間 / 網站 / 照片）
    //
    const result = [];

    for (let p of items) {
      const detailUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/details/json"
      );
      detailUrl.searchParams.set("key", GOOGLE_API_KEY);
      detailUrl.searchParams.set("place_id", p.place_id);
      detailUrl.searchParams.set(
        "fields",
        "name,formatted_address,formatted_phone_number,rating,opening_hours,website,url,photos,geometry"
      );

      const detailData = await (await fetch(detailUrl)).json();
      const d = detailData.result;

      // 圖片（取第一張）
      let photoUrl = null;
      if (d.photos?.length) {
        const ref = d.photos[0].photo_reference;
        photoUrl = 
          `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_API_KEY}`;
      }

      // 距離
      const dist = calcDistance(
        center.lat,
        center.lng,
        d.geometry.location.lat,
        d.geometry.location.lng
      );

      // 是否營業中
      let openStatus = "未知";
      if (d.opening_hours?.open_now === true) openStatus = "營業中";
      else if (d.opening_hours?.open_now === false) openStatus = "已打烊";

      result.push({
        name: d.name,
        address: d.formatted_address,
        phone: d.formatted_phone_number || null,
        rating: d.rating || null,
        openingHours: d.opening_hours?.weekday_text || null,
        openStatus,
        googleMapsUrl: d.url,
        reservationUrl: d.website || null,
        photo: photoUrl,
        distanceKm: Number(dist.toFixed(2)),
      });
    }

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});