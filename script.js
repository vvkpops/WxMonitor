const apiKey = "KpWgT1e-r9LPmpxOhmsOokTsAlSKP7FKYVLs1mYEmXw";
let airports = JSON.parse(localStorage.getItem("airports")) || [];
let showOnlyBelowMinima = false;
const belowMinimaMap = {};

function updateClocks() {
  const now = new Date();
  document.getElementById("utcClock").textContent = `UTC ${now.toUTCString().slice(17, 25)}`;
  document.getElementById("localClock").textContent = `Local ${now.toTimeString().slice(0, 8)}`;
}
setInterval(updateClocks, 1000);
updateClocks();

function saveAirports() {
  localStorage.setItem("airports", JSON.stringify(airports));
}

window.addEventListener("storage", () => {
  airports = JSON.parse(localStorage.getItem("airports")) || [];
  renderDashboard();
});

function addAirport() {
  const input = document.getElementById("icaoInput");
  const icao = input.value.toUpperCase().trim();
  input.value = "";
  if (!icao.match(/^[A-Z]{4}$/)) return alert("Enter valid 4-letter ICAO");
  if (airports.find(a => a.icao === icao)) return;
  airports.push({ icao, minCeiling: 3000, minVis: 3, timeFrom: null, timeTo: null });
  saveAirports();
  renderDashboard();
}

function removeAirport(icao) {
  airports = airports.filter(a => a.icao !== icao);
  saveAirports();
  renderDashboard();
}

const debounce = (func, delay = 300) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
};

function updateMinima(icao, field, value) {
  const airport = airports.find(a => a.icao === icao);
  if (airport) {
    airport[field] = parseFloat(value);
    saveAirports();
    renderDashboard();
  }
}
const debouncedUpdateMinima = debounce(updateMinima);

function updateTime(icao, field, value) {
  const airport = airports.find(a => a.icao === icao);
  if (airport) {
    airport[field] = value === "" ? null : parseInt(value);
    saveAirports();
    renderDashboard();
  }
}

function applyGlobalMinima() {
  const ceiling = parseFloat(document.getElementById("globalCeiling").value);
  const vis = parseFloat(document.getElementById("globalVis").value);
  if (isNaN(ceiling) || isNaN(vis)) return alert("Enter valid minima");
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

function withinHourWindow(hour, from, to) {
  if (isNaN(from) || isNaN(to)) return true;
  return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
}

function parseVisibility(vis) {
  if (typeof vis === "number") return vis;
  if (typeof vis === "string") {
    if (vis.includes('/')) {
      const [num, denom] = vis.split('/').map(Number);
      return denom ? num / denom : NaN;
    }
    return parseFloat(vis);
  }
  return NaN;
}

function renderDashboard() {
  const container = document.getElementById("dashboard");
  container.innerHTML = "";
  airports.forEach(airport => {
    const card = document.createElement("div");
    card.id = `card-${airport.icao}`;
    card.className = "bg-gray-800 p-4 rounded-2xl shadow-lg border border-gray-700 hover:scale-[1.02] transition-transform duration-300 text-gray-200";

    card.innerHTML = `
      <div class="flex justify-between mb-2">
        <h2 class="text-xl font-bold tracking-wide">${airport.icao}</h2>
        <button onclick="removeAirport('${airport.icao}')" class="text-red-400 hover:text-red-600 text-xl leading-none">✖</button>
      </div>
      <div class="flex flex-col gap-2 mb-2">
        <div class="flex gap-2">
          <input type="number" value="${airport.minCeiling ?? ''}" step="100"
            oninput="debouncedUpdateMinima('${airport.icao}', 'minCeiling', this.value)"
            class="p-2 border border-gray-600 rounded-lg w-24 bg-gray-700 text-center focus:ring-2 ring-green-400" />
          <input type="number" value="${airport.minVis ?? ''}" step="0.1"
            oninput="debouncedUpdateMinima('${airport.icao}', 'minVis', this.value)"
            class="p-2 border border-gray-600 rounded-lg w-24 bg-gray-700 text-center focus:ring-2 ring-green-400" />
        </div>
        <div class="flex gap-2 items-center">
          <input type="number" min="0" max="23" value="${airport.timeFrom ?? ''}"
            onchange="updateTime('${airport.icao}', 'timeFrom', this.value)"
            class="p-2 border border-gray-600 rounded-lg w-16 bg-gray-700 text-center focus:ring-2 ring-blue-400" /><span>Z to</span>
          <input type="number" min="0" max="23" value="${airport.timeTo ?? ''}"
            onchange="updateTime('${airport.icao}', 'timeTo', this.value)"
            class="p-2 border border-gray-600 rounded-lg w-16 bg-gray-700 text-center focus:ring-2 ring-blue-400" /><span>Z</span>
        </div>
        <button onclick="setStandardMinima('${airport.icao}')" class="text-xs text-blue-400 hover:underline">Set Standard Alternate Minima</button>
      </div>
      <pre id="metar-${airport.icao}" class="text-xs text-gray-200 whitespace-pre-wrap break-words mb-1 bg-gray-900 p-2 rounded-lg border border-gray-600"></pre>
      <pre id="taf-${airport.icao}" class="text-xs text-gray-200 whitespace-pre-wrap break-words bg-gray-900 p-2 rounded-lg border border-gray-600"></pre>
      <div id="alert-${airport.icao}" class="mt-2 text-sm font-semibold"></div>
    `;

    container.appendChild(card);
    if (showOnlyBelowMinima && !belowMinimaMap[airport.icao]) {
      card.style.display = "none";
    }
    fetchWeather(airport);
  });
}

async function fetchWeather(airport) {
  const { icao, minCeiling, minVis, timeFrom, timeTo } = airport;
  const metarUrl = `https://avwx.rest/api/metar/${icao}?options=summary&format=json`;
  const tafUrl = `https://avwx.rest/api/taf/${icao}?options=summary&format=json`;

  try {
    const [metarRes, tafRes] = await Promise.all([
      fetch(metarUrl, { headers: { Authorization: apiKey } }),
      fetch(tafUrl, { headers: { Authorization: apiKey } })
    ]);

    const metar = await metarRes.json();
    const taf = await tafRes.json();

    document.getElementById(`metar-${icao}`).textContent = `METAR: ${metar.raw || "N/A"}`;

    let tafText = taf.raw || "N/A";
    let belowMinima = false;

    taf.forecast?.forEach(period => {
      const hour = new Date(period.start_time.dt).getUTCHours();
      if (withinHourWindow(hour, timeFrom, timeTo)) {
        const cloud = period.clouds?.find(c => ["BKN", "OVC", "VV"].includes(c.type));
        const ceiling = cloud?.base_ft_agl ?? (cloud?.altitude ? cloud.altitude * 100 : null);
        const vis = parseVisibility(period.visibility?.value);
        if ((ceiling !== null && ceiling <= minCeiling) || (vis !== null && vis <= minVis)) {
          belowMinima = true;
        }
      }
    });

    if (belowMinima) {
      tafText = tafText
        // highlight fractional or decimal vis
        .replace(/(\d+\/\d+|\d+(?:\.\d+)?)(SM)/g, (match, val, sm) => {
          return parseVisibility(val) <= minVis ? `<span class="text-red-400 font-bold">${match}</span>` : match;
        })
        // highlight BKN/OVC ceilings
        .replace(/(BKN|OVC|VV)(\d{3})/g, (match, type, base) => {
          const ft = parseInt(base) * 100;
          return ft <= minCeiling ? `<span class="text-red-400 font-bold">${match}</span>` : match;
        });
    }

    document.getElementById(`taf-${icao}`).innerHTML = `TAF: ${tafText}`;

    belowMinimaMap[icao] = belowMinima;
    const alertBox = document.getElementById(`alert-${icao}`);
    const card = document.getElementById(`card-${icao}`);

    if (!alertBox || !card) return;

    alertBox.textContent = belowMinima ? "⚠️ Below minima in TAF (selected hours)" : "✅ Conditions above minima";
    alertBox.className = belowMinima
      ? "mt-2 text-sm font-semibold text-red-400"
      : "mt-2 text-sm font-semibold text-green-400";

    card.className = belowMinima
      ? "bg-red-900/80 p-4 rounded-2xl shadow-xl border border-red-400 ring-2 ring-red-400 transition-all duration-500 text-gray-200"
      : "bg-gray-800 p-4 rounded-2xl shadow-lg border border-green-500 ring-2 ring-green-500 transition-all duration-500 text-gray-200";

    if (showOnlyBelowMinima) card.style.display = belowMinima ? "block" : "none";
  } catch {
    const alertBox = document.getElementById(`alert-${icao}`);
    if (alertBox) alertBox.textContent = "⚠️ Failed to fetch data";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard();
  document.getElementById("addBtn").addEventListener("click", addAirport);
  document.getElementById("icaoInput").addEventListener("keydown", e => {
    if (e.key === "Enter") addAirport();
  });
  document.getElementById("toggleFilter").addEventListener("click", () => {
    showOnlyBelowMinima = !showOnlyBelowMinima;
    document.getElementById("toggleFilter").textContent = showOnlyBelowMinima
      ? "Show All Airports"
      : "Show Only Below Minima";
    renderDashboard();
  });
});

setInterval(() => {
  airports.forEach(fetchWeather);
}, 300000);
