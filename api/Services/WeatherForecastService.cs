using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using HappyHealthyHethersett.Api.Models;

namespace HappyHealthyHethersett.Api.Services;

public class WeatherForecastService
{
    private const double DefaultLatitude = 52.60099;
    private const double DefaultLongitude = 1.17553;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);
    private static readonly TimeZoneInfo LondonTimeZone = CreateLondonTimeZone();
    private readonly ConcurrentDictionary<string, WeatherForecastCacheItem> _cache = new(StringComparer.Ordinal);
    private readonly HttpClient _httpClient;

    public WeatherForecastService()
    {
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri("https://api.open-meteo.com/v1/"),
            Timeout = TimeSpan.FromSeconds(10)
        };
        _httpClient.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            "HappyHealthyHethersett/1.0 (https://happyhealthyhethersett.org)");
    }

    public async Task<WeatherForecastDto> GetForecastAsync(
        string dateText,
        string? timeText,
        double? latitude,
        double? longitude,
        CancellationToken cancellationToken)
    {
        if (!DateOnly.TryParseExact(dateText, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return Unavailable("Forecast unavailable");
        }

        var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, LondonTimeZone);
        var today = DateOnly.FromDateTime(now.DateTime);
        if (date < today)
        {
            return new WeatherForecastDto
            {
                Available = false,
                Status = "past",
                Summary = "Forecast no longer available",
                Date = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            };
        }

        if (date > today.AddDays(15))
        {
            return new WeatherForecastDto
            {
                Available = false,
                Status = "too-far",
                Summary = "Forecast available closer to the date",
                Date = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            };
        }

        var forecastHour = ForecastHour(timeText);
        var forecastTime = new TimeOnly(forecastHour, 0);
        var normalizedLatitude = NormalizeCoordinate(latitude, DefaultLatitude, -90, 90);
        var normalizedLongitude = NormalizeCoordinate(longitude, DefaultLongitude, -180, 180);
        var cacheKey = string.Join(
            ":",
            date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            forecastHour.ToString("00", CultureInfo.InvariantCulture),
            normalizedLatitude.ToString("F4", CultureInfo.InvariantCulture),
            normalizedLongitude.ToString("F4", CultureInfo.InvariantCulture));

        if (TryGetCachedForecast(cacheKey, out var cachedForecast))
        {
            return cachedForecast;
        }

        try
        {
            var forecast = await FetchForecastAsync(date, forecastTime, normalizedLatitude, normalizedLongitude, cancellationToken);
            _cache[cacheKey] = new WeatherForecastCacheItem(DateTimeOffset.UtcNow, forecast);
            return forecast;
        }
        catch
        {
            return Unavailable("Forecast unavailable");
        }
    }

    private async Task<WeatherForecastDto> FetchForecastAsync(
        DateOnly date,
        TimeOnly forecastTime,
        double latitude,
        double longitude,
        CancellationToken cancellationToken)
    {
        var dateValue = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var parameters = new Dictionary<string, string>
        {
            ["latitude"] = latitude.ToString("F5", CultureInfo.InvariantCulture),
            ["longitude"] = longitude.ToString("F5", CultureInfo.InvariantCulture),
            ["hourly"] = "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m",
            ["timezone"] = "Europe/London",
            ["temperature_unit"] = "celsius",
            ["wind_speed_unit"] = "mph",
            ["precipitation_unit"] = "mm",
            ["start_date"] = dateValue,
            ["end_date"] = dateValue
        };
        var queryString = string.Join("&", parameters.Select(item =>
            $"{Uri.EscapeDataString(item.Key)}={Uri.EscapeDataString(item.Value)}"));

        using var response = await _httpClient.GetAsync($"forecast?{queryString}", cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return Unavailable("Forecast unavailable");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var payload = await JsonSerializer.DeserializeAsync<OpenMeteoForecastResponse>(stream, JsonOptions, cancellationToken);
        var hourly = payload?.Hourly;
        if (hourly is null || hourly.Time.Count == 0)
        {
            return Unavailable("Forecast unavailable");
        }

        var expectedTime = $"{dateValue}T{forecastTime:HH\\:mm}";
        var index = hourly.Time.FindIndex(item => string.Equals(item, expectedTime, StringComparison.Ordinal));
        if (index < 0)
        {
            index = ClosestTimeIndex(hourly.Time, date, forecastTime);
        }

        if (index < 0)
        {
            return Unavailable("Forecast unavailable");
        }

        var weatherCode = IntValue(hourly.WeatherCode, index);
        return new WeatherForecastDto
        {
            Available = true,
            Status = "available",
            Summary = SummaryFor(weatherCode),
            Date = dateValue,
            Time = forecastTime.ToString("HH\\:mm", CultureInfo.InvariantCulture),
            TemperatureC = Rounded(DoubleValue(hourly.Temperature2m, index), 0),
            PrecipitationProbability = IntValue(hourly.PrecipitationProbability, index),
            WindSpeedMph = Rounded(DoubleValue(hourly.WindSpeed10m, index), 0),
            WindGustMph = Rounded(DoubleValue(hourly.WindGusts10m, index), 0),
            WeatherCode = weatherCode
        };
    }

    private bool TryGetCachedForecast(string key, out WeatherForecastDto forecast)
    {
        if (_cache.TryGetValue(key, out var cached) &&
            DateTimeOffset.UtcNow - cached.CachedAt <= CacheDuration)
        {
            forecast = cached.Forecast;
            return true;
        }

        forecast = new WeatherForecastDto();
        return false;
    }

    private static int ClosestTimeIndex(List<string> times, DateOnly date, TimeOnly target)
    {
        var bestIndex = -1;
        var bestDistance = int.MaxValue;
        for (var index = 0; index < times.Count; index += 1)
        {
            if (!DateTime.TryParseExact(
                    times[index],
                    "yyyy-MM-dd'T'HH:mm",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var parsed) ||
                DateOnly.FromDateTime(parsed) != date)
            {
                continue;
            }

            var parsedTime = TimeOnly.FromDateTime(parsed);
            var distance = Math.Abs((int)(parsedTime - target).TotalMinutes);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                bestIndex = index;
            }
        }

        return bestIndex;
    }

    private static int ForecastHour(string? timeText)
    {
        if (string.IsNullOrWhiteSpace(timeText))
        {
            return 12;
        }

        var cleaned = timeText.Trim().ToLowerInvariant().Replace(".", "", StringComparison.Ordinal);
        var formats = new[]
        {
            "H:mm",
            "HH:mm",
            "H.mm",
            "HH.mm",
            "h:mmtt",
            "htt",
            "h:mm tt",
            "h tt"
        };
        if (TimeOnly.TryParseExact(cleaned, formats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var time) ||
            TimeOnly.TryParse(cleaned, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out time))
        {
            return time.Minute >= 30 ? Math.Min(time.Hour + 1, 23) : time.Hour;
        }

        return 12;
    }

    private static WeatherForecastDto Unavailable(string summary)
    {
        return new WeatherForecastDto
        {
            Available = false,
            Status = "unavailable",
            Summary = summary
        };
    }

    private static double NormalizeCoordinate(double? value, double fallback, double minimum, double maximum)
    {
        var parsed = value ?? fallback;
        return double.IsFinite(parsed) ? Math.Clamp(parsed, minimum, maximum) : fallback;
    }

    private static double? DoubleValue(List<double?> values, int index)
    {
        return index >= 0 && index < values.Count ? values[index] : null;
    }

    private static int? IntValue(List<int?> values, int index)
    {
        return index >= 0 && index < values.Count ? values[index] : null;
    }

    private static double? Rounded(double? value, int digits)
    {
        return value.HasValue ? Math.Round(value.Value, digits, MidpointRounding.AwayFromZero) : null;
    }

    private static string SummaryFor(int? weatherCode)
    {
        return weatherCode switch
        {
            0 => "Clear",
            1 => "Mainly clear",
            2 => "Partly cloudy",
            3 => "Overcast",
            45 or 48 => "Fog",
            51 => "Light drizzle",
            53 => "Drizzle",
            55 => "Heavy drizzle",
            56 or 57 => "Freezing drizzle",
            61 => "Light rain",
            63 => "Rain",
            65 => "Heavy rain",
            66 or 67 => "Freezing rain",
            71 => "Light snow",
            73 => "Snow",
            75 => "Heavy snow",
            77 => "Snow grains",
            80 => "Light showers",
            81 => "Showers",
            82 => "Heavy showers",
            85 or 86 => "Snow showers",
            95 => "Thunderstorm",
            96 or 99 => "Thunderstorm with hail",
            _ => "Forecast"
        };
    }

    private static TimeZoneInfo CreateLondonTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    private sealed record WeatherForecastCacheItem(DateTimeOffset CachedAt, WeatherForecastDto Forecast);

    private sealed class OpenMeteoForecastResponse
    {
        [JsonPropertyName("hourly")]
        public OpenMeteoHourlyData? Hourly { get; set; }
    }

    private sealed class OpenMeteoHourlyData
    {
        [JsonPropertyName("time")]
        public List<string> Time { get; set; } = new();

        [JsonPropertyName("temperature_2m")]
        public List<double?> Temperature2m { get; set; } = new();

        [JsonPropertyName("precipitation_probability")]
        public List<int?> PrecipitationProbability { get; set; } = new();

        [JsonPropertyName("weather_code")]
        public List<int?> WeatherCode { get; set; } = new();

        [JsonPropertyName("wind_speed_10m")]
        public List<double?> WindSpeed10m { get; set; } = new();

        [JsonPropertyName("wind_gusts_10m")]
        public List<double?> WindGusts10m { get; set; } = new();
    }
}
