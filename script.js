const apiKey = "KpWgT1e-r9LPmpxOhmsOokTsAlSKP7FKYVLs1mYEmXw";
const refreshInterval = 5 * 60 * 1000;
let airports = JSON.parse(localStorage.getItem("airports")) || [];

function saveAirports() {
  localStorage.setItem("airports", JSON.stringify(airports));
}

function addAirport() {
  const input = document.getElementById("icaoInput");
  const icao = input.value.toUpperCase().trim();
  input.value = "";

  if (!icao.match(/^[A-Z]{4}$/)) {
    alert("Please enter a valid 4-letter ICAO code.");
    return;
  }

  if (airports.find(a => a.icao === icao)) return;

  airports.push({ icao, minCeiling: 3000, minVis: 3 });
  saveAirports();
  renderDashboard();
}

function removeAirport(icao) {
  airports = airports.filter(a => a.icao !== icao);
  saveAirports();
  renderDashboard();
}

function updateMinima(icao, field, value) {
  const airport = airports.find(a => a.icao === icao);
  if (airport) {
    airport[field] = parseFloat(value);
    saveAirports();
    fetchWeather(airport);
  }
}

function applyGlobalMinima() {
  const ceiling = parseFloat(document.getElementById("globalCeiling").value);
  const vis = parseFloat(document.getElementById("globalVis").value);
  if (isNaN(ceiling) || isNaN(vis)) {
    alert("Please enter valid minima values.");
    return;
  }
  airports.forEach(airport => {
    airport.minCeiling = ceiling;
    airport.minVis = vis;
  });
  saveAirports();
  renderDashboard();
}

function setStandardMinima(icao) {
  const airport = airports.find(a => a.icao === icao);
  if (airport) {
    airport.minCeiling = 600;
    airport.minVis = 2;
    saveAirports();
    renderDashboard();
  }
}

function renderDashboard() {
  const container = document.getElementById("dashboard");
  container.innerHTML = "";

  airports.forEach(airport => {
    const card = document.createElement("div");
    card.className = "bg-white p-4 rounded shadow relative";

    card.innerHTML = `
      <button onclick="removeAirport('${airport.icao}')" class="absolute top-2 right-2 text-red-500 hover:text-red-700">✖</button>
      <h2 class="text-xl font-bold mb-2">${airport.icao}</h2>
      <div class="flex flex-col gap-1 mb-2">
        <div class="flex gap-2">
          <input type="number" value="${airport.minCeiling}" onchange="updateMinima('${airport.icao}', 'minCeiling', this.value)" class="p-1 border rounded w-24" />
          <input type="number" value="${airport.minVis}" onchange="updateMinima('${airport.icao}', 'minVis', this.value)" class="p-1 border rounded w-24" />
        </div>
        <button onclick="setStandardMinima('${airport.icao}')" class="text-xs text-blue-600 hover:underline self-start">Set Standard Alternate Minima</button>
      </div>
      <pre id="metar-${airport.icao}" class="text-sm mb-1 whitespace-pre-wrap break-words"></pre>
      <pre id="taf-${airport.icao}" class="text-sm whitespace-pre-wrap break-words bg-gray-50 p-2 rounded border border-gray-300"></pre>
      <div id="alert-${airport.icao}" class="mt-2 text-sm font-semibold"></div>
    `;

    container.appendChild(card);
    fetchWeather(airport);
  });
}

async function fetchWeather(airport) {
  const { icao, minCeiling, minVis } = airport;
  const metarUrl = `https://avwx.rest/api/metar/${icao}?options=summary&format=json`;
  const tafUrl = `https://avwx.rest/api/taf/${icao}?options=summary&format=json`;

  try {
    const [metarRes, tafRes] = await Promise.all([
      fetch(metarUrl, { headers: { Authorization: apiKey } }),
      fetch(tafUrl, { headers: { Authorization: apiKey } })
    ]);

    const metar = await metarRes.json();
    const taf = await tafRes.json();

    document.getElementById(`metar-${icao}`).textContent = `METAR: ${metar.raw}`;

    let highlightedTAF = taf.raw;

    highlightedTAF = highlightedTAF.replace(/\b(BKN|OVC|VV)(\d{3})\b/g, (match, type, level) => {
      const feet = parseInt(level) * 100;
      return feet < minCeiling ? `<span class="text-red-600 font-bold">${match}</span>` : match;
    });

    highlightedTAF = highlightedTAF.replace(/\b(\d+\/\d+|\d+)\s?SM\b/g, (match) => {
      const parts = match.split("SM")[0].trim();
      let value = parts.includes("/") ? eval(parts) : parseFloat(parts);
      return value < minVis ? `<span class="text-red-600 font-bold">${match}</span>` : match;
    });

    document.getElementById(`taf-${icao}`).innerHTML = `TAF: ${highlightedTAF}`;

    let alert = "";
    let alertColor = "text-green-700";

    taf.forecast.forEach(period => {
      const cloud = period.clouds?.find(cloud =>
        ["BKN", "OVC", "VV"].includes(cloud.type)
      );
      const ceiling = cloud?.base_ft_agl ?? (cloud?.altitude ? cloud.altitude * 100 : null);
      const vis = period.visibility?.value ?? null;

      if ((ceiling !== null && ceiling < minCeiling) || (vis !== null && vis < minVis)) {
        alert = `⚠️ Below minima in TAF`;
        alertColor = "text-red-700";
      }
    });

    const alertBox = document.getElementById(`alert-${icao}`);
    alertBox.textContent = alert || "✅ Conditions above minima";
    alertBox.className = `mt-2 text-sm font-semibold ${alertColor}`;
  } catch (err) {
    document.getElementById(`alert-${icao}`).textContent = "⚠️ Failed to fetch data";
    document.getElementById(`alert-${icao}`).className = "mt-2 text-sm font-semibold text-yellow-700";
  }
}

function refreshAll() {
  airports.forEach(fetchWeather);
}

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard();
  setInterval(refreshAll, refreshInterval);

  document.getElementById("icaoInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addAirport();
  });

  document.getElementById("addBtn").addEventListener("click", addAirport);
});