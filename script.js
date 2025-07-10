
const apiKey = "leC8UiUJc0WZlS57wrMO5AmrumbXOhXpiChLlnkM1k4";
let airports = JSON.parse(localStorage.getItem("airports")) || [];
let showOnlyBelowMinima = false;

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

function addAirport() {
  const input = document.getElementById("icaoInput");
  const icao = input.value.toUpperCase().trim();
  input.value = "";
  if (!icao.match(/^[A-Z]{4}$/)) return alert("Enter valid 4-letter ICAO");
  if (airports.find(a => a.icao === icao)) return;
  airports.push({ icao, minCeiling: 3000, minVis: 3, fromTime: "", toTime: "" });
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
    airport[field] = value ? (field.includes("Time") ? value : parseFloat(value)) : "";
    saveAirports();
    renderDashboard();
  }
}

function applyGlobalMinima() {
  const ceiling = parseFloat(document.getElementById("globalCeiling").value);
  const vis = parseFloat(document.getElementById("globalVis").value);
  const fromTime = document.getElementById("globalFrom").value;
  const toTime = document.getElementById("globalTo").value;
  airports.forEach(airport => {
    if (!isNaN(ceiling)) airport.minCeiling = ceiling;
    if (!isNaN(vis)) airport.minVis = vis;
    airport.fromTime = fromTime;
    airport.toTime = toTime;
  });
  saveAirports();
  renderDashboard();
}

function extractForecastPeriod(str) {
  let fmMatch = str.match(/FM(\d{2})/);
  if (fmMatch) return { start: parseInt(fmMatch[1]), end: parseInt(fmMatch[1]) };
  let rangeMatch = str.match(/(\d{2})(\d{2})\/(\d{2})(\d{2})/);
  if (rangeMatch) return { start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[3]) };
  return null;
}

function periodsOverlap(periodStart, periodEnd, userStart, userEnd) {
  return (periodStart <= userEnd && periodEnd >= userStart);
}

async function fetchWeather(airport) {
  const { icao, minCeiling, minVis, fromTime, toTime } = airport;
  const metarUrl = `https://avwx.rest/api/metar/${icao}?options=summary&format=json`;
  const tafUrl = `https://avwx.rest/api/taf/${icao}?options=summary&format=json`;
  const stationUrl = `https://avwx.rest/api/station/${icao}`;

  try {
    const [metarRes, tafRes, stationRes] = await Promise.all([
      fetch(metarUrl, { headers: { Authorization: apiKey } }),
      fetch(tafUrl, { headers: { Authorization: apiKey } }),
      fetch(stationUrl, { headers: { Authorization: apiKey } })
    ]);

    const metar = await metarRes.json();
    const taf = await tafRes.json();
    const station = await stationRes.json();

    const header = document.querySelector(`#card-${icao} h2`);
    if (header) header.innerHTML = `${icao} - ${station.name || station.city || "Unknown"}`;

    let tafHtml = taf.raw || "N/A";
    let lines = tafHtml.split(/\r?\n|\s+(?=FM|PROB|BECMG|TEMPO)/);
    tafHtml = lines.map(line => {
      let isViolating = false;
      let scanThis = true;

      let period = extractForecastPeriod(line);
      if (fromTime && toTime && period !== null) {
        let fromHr = parseInt(fromTime);
        let toHr = parseInt(toTime);
        scanThis = periodsOverlap(period.start, period.end, fromHr, toHr);
      }

      if (scanThis && line.match(/FM|PROB|BECMG|TEMPO/)) {
        let ceilingMatch = line.match(/(BKN|OVC|VV)(\d{3})/);
        let ceiling = ceilingMatch ? parseInt(ceilingMatch[2]) * 100 : Infinity;

        let vis;
        if (line.includes("P6SM")) {
          vis = Infinity;
        } else {
          let visMatch = line.match(/(\d{1,2})SM/);
          vis = visMatch ? parseInt(visMatch[1]) : Infinity;
        }

        if (ceiling < minCeiling || vis < minVis) isViolating = true;
      }
      return isViolating ? `<div class='bg-red-700/30 rounded p-0.5'>${line}</div>` : `<div>${line}</div>`;
    }).join("");

    document.getElementById(`metar-${icao}`).textContent = `METAR: ${metar.raw || "N/A"}`;
    document.getElementById(`taf-${icao}`).innerHTML = `TAF:<br>${tafHtml}`;

    const belowMinima = taf.forecast?.some(period => {
      const ceiling = period.clouds?.reduce((acc, c) => {
        const alt = c.base_ft_agl ?? (c.altitude ? c.altitude * 100 : Infinity);
        return (["BKN","OVC","VV"].includes(c.type) && alt < acc) ? alt : acc;
      }, Infinity);
      const vis = period.visibility?.repr === "P6SM" ? Infinity : parseFloat(period.visibility?.value ?? Infinity);
      return ceiling < minCeiling || vis < minVis;
    });

    const alertBox = document.getElementById(`alert-${icao}`);
    const card = document.getElementById(`card-${icao}`);
    alertBox.innerHTML = belowMinima
      ? "🚨 <span class='text-red-400 font-bold'>Below minima detected in TAF</span>"
      : "✅ <span class='text-green-400 font-bold'>Conditions above minima</span>";
    card.className = belowMinima
      ? "bg-red-900/80 hover:bg-red-900/90 p-4 rounded-2xl shadow-xl border border-red-400 ring-2 ring-red-400 transition-all duration-500 hover:scale-105 hover:shadow-2xl ring-offset-2 ring-offset-gray-900 animate-pulse text-gray-200"
      : "bg-gray-800 hover:bg-gray-700 p-4 rounded-2xl shadow-lg border border-green-500 ring-2 ring-green-500 transition-all duration-500 hover:scale-105 hover:shadow-2xl ring-offset-2 ring-offset-gray-900 animate-pulse text-gray-200";

    if (showOnlyBelowMinima && !belowMinima) {
      card.style.display = "none";
    } else {
      card.style.display = "block";
    }

  } catch {
    document.getElementById(`alert-${icao}`).textContent = "⚠️ Failed to fetch data";
  }
}

function renderDashboard() {
  const container = document.getElementById("dashboard");
  container.innerHTML = "";
  airports.forEach(airport => {
    const card = document.createElement("div");
    card.id = `card-${airport.icao}`;
    card.className = "bg-gray-800 p-4 rounded-2xl shadow-lg border border-gray-700 transition-transform duration-300 text-gray-200";

    card.innerHTML = `
      <div class="flex justify-between mb-2">
        <h2 class="text-xl font-bold tracking-wide">${airport.icao}</h2>
        <button onclick="removeAirport('${airport.icao}')" class="text-red-400 hover:text-red-600 text-xl leading-none">✖</button>
      </div>
      <div class="flex gap-2 mb-2 flex-wrap">
        <input type="number" value="${airport.minCeiling ?? ''}" step="100"
          onchange="updateMinima('${airport.icao}', 'minCeiling', this.value)"
          class="p-2 border border-gray-600 rounded-lg w-24 bg-gray-700 text-center focus:ring-2 ring-green-400" />
        <input type="number" value="${airport.minVis ?? ''}" step="0.1"
          onchange="updateMinima('${airport.icao}', 'minVis', this.value)"
          class="p-2 border border-gray-600 rounded-lg w-24 bg-gray-700 text-center focus:ring-2 ring-green-400" />
        <input type="number" value="${airport.fromTime ?? ''}" placeholder="From Z"
          onchange="updateMinima('${airport.icao}', 'fromTime', this.value)"
          class="p-2 border border-gray-600 rounded-lg w-24 bg-gray-700 text-center focus:ring-2 ring-yellow-400" />
        <input type="number" value="${airport.toTime ?? ''}" placeholder="To Z"
          onchange="updateMinima('${airport.icao}', 'toTime', this.value)"
          class="p-2 border border-gray-600 rounded-lg w-24 bg-gray-700 text-center focus:ring-2 ring-yellow-400" />
      </div>
      <pre id="metar-${airport.icao}" class="text-xs text-gray-200 whitespace-pre-wrap break-words mb-1 bg-gray-900 p-2 rounded-lg border border-gray-600"></pre>
      <div id="taf-${airport.icao}" class="text-xs text-gray-200 whitespace-pre-wrap break-words bg-gray-900 p-2 rounded-lg border border-gray-600"></div>
      <div id="alert-${airport.icao}" class="mt-2 text-sm font-semibold"></div>
    `;

    container.appendChild(card);
    fetchWeather(airport); card.innerHTML += `<button onclick=\"loadNotams('${airport.icao}')\" class=\"mt-2 text-yellow-400 hover:text-yellow-600\">📜 View NOTAMs</button>`;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderDashboard();
  document.getElementById("applyAllBtn").addEventListener("click", applyGlobalMinima);
  document.getElementById("addBtn").addEventListener("click", addAirport);
  document.getElementById("icaoInput").addEventListener("keydown", e => {
    if (e.key === "Enter") addAirport();
  });
  document.getElementById("toggleFilter").addEventListener("click", () => {
    showOnlyBelowMinima = !showOnlyBelowMinima;
    document.getElementById("toggleFilter").textContent = showOnlyBelowMinima ? "Show All Airports" : "Show Only Below Minima";
    airports.forEach(fetchWeather);
  });
  setInterval(() => { airports.forEach(fetchWeather); }, 300000);
});

function loadNotams(icao) {
  document.getElementById("notamPanel").classList.remove("hidden");
  document.getElementById("notamTitle").textContent = `NOTAMs for ${icao}`;
  document.getElementById("notamContent").innerHTML = `<iframe src='https://ourairports.com/airports/${icao}/notams.html' class='w-full h-full border-0'></iframe>`;
}
function closeNotams() {
  document.getElementById("notamPanel").classList.add("hidden");
}
