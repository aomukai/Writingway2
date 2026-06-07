// Writingway config fetcher
// Fetches /writingway.json from the local app server and makes
// port values available globally. Silently fails and falls back
// to hardcoded defaults on any error.
(function () {
    var config = {
        port: 8000,
        updaterPort: 8001,
        aiPort: 8080
    };

    function load() {
        fetch('/writingway.json')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.port != null) config.port = data.port;
                if (data.updaterPort != null) config.updaterPort = data.updaterPort;
                if (data.aiPort != null) config.aiPort = data.aiPort;
            })
            .catch(function () { /* silently fallback to defaults */ });
    }

    load();

    window.WritingwayConfig = config;
})();
