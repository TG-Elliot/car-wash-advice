// Элементы интерфейса
const adviceCard = document.getElementById('adviceCard');
const adviceEmoji = document.getElementById('adviceEmoji');
const adviceText = document.getElementById('adviceText');
const adviceReason = document.getElementById('adviceReason');
const forecastEl = document.getElementById('forecast');
const checkBtn = document.getElementById('checkBtn');
const geoBtn = document.getElementById('geoBtn');
const cityInput = document.getElementById('cityInput');
const scoreBadge = document.getElementById('scoreBadge');
const scoreValue = document.getElementById('scoreValue');
const notifyBtn = document.getElementById('notifyBtn');
const loader = document.getElementById('loader');

let map;
let marker;
let lastAdvice = null; // чтобы использовать в уведомлении

// ---------- Вспомогательные функции ----------

function showLoader(message) {
  if (!loader) return;
  const textEl = loader.querySelector('.loader-text');
  if (textEl && message) textEl.textContent = message;
  loader.classList.add('visible');
}

function hideLoader() {
  if (!loader) return;
  loader.classList.remove('visible');
}

// ---------- 1. API: погода и геокодинг (Open-Meteo) ----------

// Прогноз по координатам
async function getForecastByCoords(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lon}` +
    `&hourly=precipitation,temperature_2m` +
    `&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Не удалось получить погоду');
  }
  return await res.json();
}

// Поиск координат по названию города (ограничиваем Россией)
async function getCoordsByCity(city) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      city
    )}&count=1&language=ru&format=json&country=RU`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Ошибка геокодинга');
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('Город не найден');
  }
  const place = data.results[0];

  const cleanedCity = city.trim();

  return {
    lat: place.latitude,
    lon: place.longitude,
    label: cleanedCity ? `${cleanedCity}, Россия` : `${place.name}, Россия`,
  };
}

// ---------- 2. Логика оценки мойки и погоды ----------

// Считаем "оценку дня" 0–10
function computeWashScoreFromMeteo(data) {
  const precip = data.hourly.precipitation;
  const temps = data.hourly.temperature_2m;

  const next48Precip = precip.slice(0, 48);
  const next48Temps = temps.slice(0, 48);

  const avgTemp =
    next48Temps.reduce((s, t) => s + t, 0) / next48Temps.length;

  const maxPrecip = Math.max(...next48Precip);
  const totalPrecip = next48Precip.reduce((s, p) => s + p, 0);

  // базовый балл
  let score = 10;

  // Чем больше осадков суммарно – тем хуже
  if (totalPrecip > 5) score -= 4;
  else if (totalPrecip > 2) score -= 2;
  else if (totalPrecip > 0.5) score -= 1;

  // Если будет сильный дождь/снег
  if (maxPrecip > 2) score -= 3;
  else if (maxPrecip > 1) score -= 2;

  // Сильный плюс после возможного снега – плохо
  if (avgTemp > 2 && maxPrecip > 0.5) {
    score -= 1;
  }

  // Ограничиваем 0–10
  score = Math.max(0, Math.min(10, Math.round(score)));
  return score;
}

// Определяем "настроение" погоды для фона
function detectWeatherMoodFromMeteo(data) {
  const precip = data.hourly.precipitation.slice(0, 24);
  const temps = data.hourly.temperature_2m.slice(0, 24);

  const avgTemp =
    temps.reduce((s, t) => s + t, 0) / temps.length;
  const maxPrecip = Math.max(...precip);
  const avgPrecip =
    precip.reduce((s, p) => s + p, 0) / precip.length;

  if (maxPrecip > 1 && avgTemp <= 1) return 'snow';
  if (maxPrecip > 0.4) return 'rain';
  if (avgPrecip > 0.1) return 'cloudy';
  return 'clear';
}

function applyWeatherTheme(mood) {
  const body = document.body;
  body.classList.remove(
    'weather-clear',
    'weather-rain',
    'weather-snow',
    'weather-cloudy'
  );
  body.classList.add(`weather-${mood}`);
}

// Решаем текст совета
function decideCarWashAdviceFromMeteo(data) {
  const precip = data.hourly.precipitation;
  const temps = data.hourly.temperature_2m;

  const next24Precip = precip.slice(0, 24);
  const next24Temps = temps.slice(0, 24);

  const avgTemp24 =
    next24Temps.reduce((sum, t) => sum + t, 0) / next24Temps.length;

  const score = computeWashScoreFromMeteo(data);

  let emoji;
  let text;
  let reason;

  if (score >= 8) {
    emoji = '😎';
    text = 'Идеальный день для мойки!';
    reason = `В ближайшие 1–2 дня почти нет осадков, средняя температура около ${Math.round(
      avgTemp24
    )}°C.`;
  } else if (score >= 5) {
    emoji = '🤔';
    text = 'Можно мыть, но есть нюансы.';
    reason = `Погода в целом нормальная, но возможны небольшие осадки. Средняя температура около ${Math.round(
      avgTemp24
    )}°C.`;
  } else {
    emoji = '😬';
    text = 'Лучше подождать с мойкой.';
    reason =
      'В ближайшие сутки ожидаются заметные осадки — машина быстро снова станет грязной.';
  }

  return { emoji, text, reason, score };
}

// Простой прогноз по дням для карточек
function buildSimpleDailyForecastFromMeteo(data) {
  const times = data.hourly.time;
  const temps = data.hourly.temperature_2m;
  const precip = data.hourly.precipitation;

  const byDate = {};

  for (let i = 0; i < times.length; i++) {
    const dateStr = times[i].split('T')[0];
    if (!byDate[dateStr]) {
      byDate[dateStr] = { temps: [], precip: [] };
    }
    byDate[dateStr].temps.push(temps[i]);
    byDate[dateStr].precip.push(precip[i]);
  }

  const dates = Object.keys(byDate).slice(0, 4);

  return dates.map((dateStr, index) => {
    const info = byDate[dateStr];

    const avgTemp =
      info.temps.reduce((s, t) => s + t, 0) / info.temps.length;
    const avgPrecip =
      info.precip.reduce((s, p) => s + p, 0) / info.precip.length;

    const dayLabel =
      index === 0
        ? 'Сегодня'
        : new Date(dateStr).toLocaleDateString('ru-RU', {
            weekday: 'short',
          });

    let icon = '⛅️';
    if (avgPrecip > 1) icon = '🌧️';
    else if (avgPrecip > 0.1) icon = '☁️';
    else if (avgTemp > 20) icon = '☀️';

    return {
      day: dayLabel,
      icon,
      temp: Math.round(avgTemp) + '°C',
    };
  });
}

// ---------- 3. Карта (Leaflet) ----------

function initMap(lat, lon) {
  if (!map) {
    map = L.map('map').setView([lat, lon], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    marker = L.marker([lat, lon]).addTo(map);

    // Клик по карте — новая точка и перерасчёт
    map.on('click', e => {
      runForecast({
        lat: e.latlng.lat,
        lon: e.latlng.lng,
        source: 'map',
      });
    });
  } else {
    map.setView([lat, lon], 10);
    marker.setLatLng([lat, lon]);
  }
}

// ---------- 4. Обновление UI ----------

function updateScoreUI(score) {
  scoreValue.textContent = score;
  scoreBadge.style.opacity = 1;
  scoreBadge.style.transform = 'scale(1.02)';
  setTimeout(() => {
    scoreBadge.style.transform = 'scale(1)';
  }, 150);
}

function showForecastCards(simpleForecast) {
  forecastEl.innerHTML = '';
  simpleForecast.forEach(item => {
    const card = document.createElement('div');
    card.className = 'forecast-card';
    card.innerHTML = `
      <div class="day">${item.day}</div>
      <div class="icon">${item.icon}</div>
      <div class="temp">${item.temp}</div>
    `;
    forecastEl.appendChild(card);
  });
  forecastEl.style.display = 'grid';
}

// Общая функция: получить данные, обновить карту и UI
async function runForecast({ lat, lon, label, source }) {
  adviceCard.style.display = 'block';
  adviceEmoji.textContent = '⏳';
  adviceText.textContent = 'Смотрю прогноз погоды...';
  adviceReason.textContent = source === 'map'
    ? 'Пересчитываю совет для выбранной точки на карте.'
    : 'Считаю, стоит ли мыть машину.';

  forecastEl.style.display = 'none';
  showLoader('Загружаю свежий прогноз…');

  try {
    const forecastData = await getForecastByCoords(lat, lon);
    const advice = decideCarWashAdviceFromMeteo(forecastData);
    const simpleForecast = buildSimpleDailyForecastFromMeteo(forecastData);
    const mood = detectWeatherMoodFromMeteo(forecastData);

    adviceEmoji.textContent = advice.emoji;
    adviceText.textContent = advice.text;
    adviceReason.textContent = label
      ? `${advice.reason} Локация: ${label}.`
      : advice.reason;

    showForecastCards(simpleForecast);
    updateScoreUI(advice.score);
    initMap(lat, lon);
    applyWeatherTheme(mood);

    lastAdvice = {
      text: advice.text,
      score: advice.score,
      label: label || 'текущая локация',
    };
  } catch (e) {
    console.error(e);
    adviceEmoji.textContent = '⚠️';
    adviceText.textContent = 'Не удалось получить погоду';
    adviceReason.textContent = 'Попробуйте позже или выберите другую точку.';
    forecastEl.style.display = 'none';
  } finally {
    hideLoader();
  }
}

// ---------- 5. Обработчики кнопок ----------

// Кнопка "Проверить"
checkBtn.addEventListener('click', async () => {
  const city = cityInput.value.trim();

  // Если город введён — используем геокодинг
  if (city) {
    adviceCard.style.display = 'block';
    adviceEmoji.textContent = '🔎';
    adviceText.textContent = 'Ищу город...';
    adviceReason.textContent = '';
    showLoader('Ищу город и прогноз…');

    try {
      const { lat, lon, label } = await getCoordsByCity(city);
      await runForecast({ lat, lon, label, source: 'city' });
    } catch (e) {
      console.error(e);
      adviceEmoji.textContent = '⚠️';
      adviceText.textContent = 'Город не найден';
      adviceReason.textContent = 'Проверьте написание и попробуйте ещё раз.';
      forecastEl.style.display = 'none';
    } finally {
      hideLoader();
    }
    return;
  }

  // Если города нет — пробуем геолокацию
  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается браузером. Введите город вручную 🙂');
    return;
  }

  adviceCard.style.display = 'block';
  adviceEmoji.textContent = '📍';
  adviceText.textContent = 'Получаю вашу геолокацию...';
  adviceReason.textContent = '';
  showLoader('Получаю геолокацию…');

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      await runForecast({ lat, lon, label: 'текущая геопозиция', source: 'geo' });
    },
    err => {
      console.error(err);
      adviceEmoji.textContent = '⚠️';
      adviceText.textContent = 'Не удалось получить геолокацию';
      adviceReason.textContent =
        'Разрешите доступ к геолокации или введите город вручную.';
      forecastEl.style.display = 'none';
      hideLoader();
    }
  );
});

// Кнопка 📍 — принудительно геолокация
geoBtn.addEventListener('click', () => {
  cityInput.value = '';
  checkBtn.click();
});

// Уведомления (демо)
notifyBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    alert('Браузер не поддерживает уведомления.');
    return;
  }

  if (!lastAdvice) {
    alert('Сначала посчитай совет по погоде 🙂');
    return;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    alert('Уведомления заблокированы в браузере.');
    return;
  }

  new Notification('Совет по мойке машины', {
    body: `${lastAdvice.text} (оценка ${lastAdvice.score}/10, локация: ${lastAdvice.label})`,
  });
});

// ---------- 6. Регистрация service worker для PWA ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch(err => console.error('SW registration failed', err));
  });
}
