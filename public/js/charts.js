// Gensar HRMS - Chart helper (Phase 3)
// Chart.js is OPTIONAL: every renderer returns false when the CDN failed,
// and callers must fall back to their plain-HTML rendering. No data logic
// lives here - only brand colors + dark-mode awareness.
(function () {
    'use strict';

    var registry = [];

    var BRAND = ['#4F46E5', '#10B981', '#E8833A', '#EF4444', '#8B5CF6', '#D09AF8', '#06B6D4', '#84CC16', '#F97316', '#6366F1'];

    function isDark() {
        return document.body.classList.contains('dark-mode');
    }

    function textColor() {
        return isDark() ? '#E5E7EB' : '#6B7280';
    }

    function gridColor() {
        return isDark() ? '#374151' : '#F3F4F6';
    }

    function palette(n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push(BRAND[i % BRAND.length]);
        return out;
    }

    function destroyExisting(canvas) {
        // Chart.js v4: getChart finds the instance bound to a canvas
        try {
            if (window.Chart && window.Chart.getChart) {
                var prev = window.Chart.getChart(canvas);
                if (prev) prev.destroy();
            }
        } catch (e) { /* ignore */ }
    }

    function baseOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: textColor(), boxWidth: 12, font: { size: 11 } } },
                tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 } }
            }
        };
    }

    // Center-label plugin for doughnuts (e.g. "12 days left")
    var centerLabelPlugin = {
        id: 'gensarCenterLabel',
        afterDraw: function (chart, args, opts) {
            if (!opts || !opts.text) return;
            var ctx = chart.ctx;
            var meta = chart.getDatasetMeta(0);
            if (!meta.data[0]) return;
            var x = meta.data[0].x, y = meta.data[0].y;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isDark() ? '#F9FAFB' : '#1F2937';
            ctx.font = '700 1.1rem Inter, sans-serif';
            ctx.fillText(opts.text, x, y - 8);
            if (opts.sub) {
                ctx.fillStyle = isDark() ? '#9CA3AF' : '#6B7280';
                ctx.font = '500 0.7rem Inter, sans-serif';
                ctx.fillText(opts.sub, x, y + 12);
            }
            ctx.restore();
        }
    };

    function renderBar(canvasId, labels, values) {
        if (!window.Chart) return false;
        var canvas = document.getElementById(canvasId);
        if (!canvas) return false;
        destroyExisting(canvas);
        var opts = baseOptions();
        opts.indexAxis = 'y';
        opts.plugins.legend.display = false;
        opts.scales = {
            x: { ticks: { color: textColor(), precision: 0 }, grid: { color: gridColor() } },
            y: { ticks: { color: textColor(), font: { size: 11 } }, grid: { display: false } }
        };
        var chart = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: palette(labels.length),
                    borderRadius: 6,
                    barThickness: 'flex',
                    maxBarThickness: 22
                }]
            },
            options: opts
        });
        registry.push({ type: 'bar', canvasId: canvasId, labels: labels, values: values });
        return chart;
    }

    function renderDoughnut(canvasId, labels, values, center) {
        if (!window.Chart) return false;
        var canvas = document.getElementById(canvasId);
        if (!canvas) return false;
        destroyExisting(canvas);
        var opts = baseOptions();
        opts.cutout = '68%';
        opts.plugins.legend.position = 'bottom';
        var plugins = [centerLabelPlugin];
        var chart = new window.Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: palette(labels.length),
                    borderWidth: isDark() ? 2 : 0,
                    borderColor: isDark() ? '#1F2937' : '#FFFFFF'
                }]
            },
            options: opts,
            plugins: plugins
        });
        // Attach center text via plugin options
        chart.options.plugins.gensarCenterLabel = center || null;
        chart.update();
        registry.push({ type: 'doughnut', canvasId: canvasId, labels: labels, values: values, center: center });
        return chart;
    }

    // Re-render all charts on theme toggle so grid/legend colors follow.
    document.addEventListener('themechange', function () {
        if (!window.Chart) return;
        var jobs = registry.slice();
        registry = [];
        jobs.forEach(function (j) {
            if (j.type === 'bar') renderBar(j.canvasId, j.labels, j.values);
            else renderDoughnut(j.canvasId, j.labels, j.values, j.center);
        });
    });

    window.GensarCharts = {
        bar: renderBar,
        doughnut: renderDoughnut,
        palette: palette
    };
})();
