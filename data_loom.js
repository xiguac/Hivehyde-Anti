/**
 * HiveHyde Anti-Crawler System - Data Loom
 * 
 * 功能:
 * 1. 作为所有环境指纹和用户行为数据的采集中心。
 * 2. 每个采集函数都必须能安全执行，并在不支持或出错时返回固定标识。
 * 3. 提供一个统一的 gather 方法，根据策略动态执行采集任务。
 * 4. 包含需要预先启动的事件监听器和行为分析。
 *
 * @version 1.0
 */
(function(window) {
    'use strict';

    const HiveHyde = window.HiveHyde || (window.HiveHyde = {});
    
    // --- 内部状态，用于动态采集 ---
    let lastMousePosition = { x: 0, y: 0, t: 0, c: 0 }; // x, y, timestamp, click count
    const mouseTrajectory = []; // 存储鼠标轨迹点

    // --- 私有采集与分析函数 ---

    /**
     * ✨【新增】分析鼠标轨迹的规律性
     * @param {Array} trajectory - 鼠标轨迹点数组 [[x, y, t], ...]
     * @returns {object} - 包含分析结果的对象
     * @private
     */
    function _analyzeMouseTrajectory(trajectory) {
        if (trajectory.length < 10) { // 点太少，不具备分析价值
            return { regularity_score: 0, is_straight_line: false };
        }

        let regularity_score = 0;
        let is_straight_line = false;

        // 1. 分析时间间隔的规律性
        const intervals = trajectory.slice(1).map((p, i) => p[2] - trajectory[i][2]);
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const stdDevInterval = Math.sqrt(intervals.map(x => Math.pow(x - avgInterval, 2)).reduce((a, b) => a + b, 0) / intervals.length);
        if (stdDevInterval < 10) { // 时间间隔标准差过小，可能是机器模拟
            regularity_score += 0.8;
        }

        // 2. 分析轨迹是否过于笔直 (斜率一致性检测)
        let consistentSlopes = 0;
        let lastSlope = null;
        for (let i = 1; i < trajectory.length; i++) {
            const dx = trajectory[i][0] - trajectory[i - 1][0];
            const dy = trajectory[i][1] - trajectory[i - 1][1];
            if (dx === 0 && dy === 0) continue; // 忽略静止点
            
            const slope = (dx === 0) ? Infinity : dy / dx;
            if (lastSlope !== null && Math.abs(slope - lastSlope) < 0.1) { // 斜率变化极小
                consistentSlopes++;
            }
            lastSlope = slope;
        }
        // 如果超过80%的点斜率都非常一致，则判定为直线
        if ((consistentSlopes / (trajectory.length - 1)) > 0.8) {
            regularity_score += 1.0;
            is_straight_line = true;
        }
        
        return { 
            regularity_score: Math.min(regularity_score, 1.0), // 得分限制在0-1之间
            is_straight_line 
        };
    }
    
    /**
     * 采集Canvas指纹
     * @private
     */
    function _getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 60;
            const ctx = canvas.getContext('2d');
            const txt = 'HiveHyde Anti-Crawler <canvas> 1.0 @!#$';
            ctx.textBaseline = 'top';
            ctx.font = '14px "Arial"';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText(txt, 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText(txt, 4, 17);
            return canvas.toDataURL();
        } catch (e) {
            return 'err_canvas';
        }
    }

    /**
     * 采集WebGL指纹
     * @private
     */
    function _getWebGLFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return 'err_no_webgl';
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) {
                return {
                    vendor: gl.getParameter(gl.VENDOR),
                    renderer: gl.getParameter(gl.RENDERER),
                };
            }
            return {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        } catch (e) {
            return 'err_webgl';
        }
    }

    /**
     * 采集音频指纹 (无声版)
     * @private
     */
    function _getAudioFingerprint() {
        return new Promise((resolve) => {
            try {
                const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                if (!OfflineAudioContext) {
                    return resolve('err_no_offline_context');
                }
                const context = new OfflineAudioContext(2, 44100 * 1.0, 44100);
                const oscillator = context.createOscillator();
                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(10000, context.currentTime);
                const compressor = context.createDynamicsCompressor();
                [['threshold', -50], ['knee', 40], ['ratio', 12], ['reduction', -20], ['attack', 0], ['release', 0.25]].forEach(item => {
                    if (compressor[item[0]] !== undefined && typeof compressor[item[0]].setValueAtTime === 'function') {
                        compressor[item[0]].setValueAtTime(item[1], context.currentTime);
                    }
                });
                oscillator.connect(compressor);
                compressor.connect(context.destination);
                oscillator.start(0);
                context.startRendering();
                context.oncomplete = (event) => {
                    try {
                        const fingerprint = event.renderedBuffer.getChannelData(0).slice(4500, 5000).reduce((acc, val) => acc + Math.abs(val), 0).toString();
                        resolve(fingerprint);
                    } catch (e) {
                        resolve('err_audio_render');
                    }
                };
            } catch (e) {
                resolve('err_audio_context');
            }
        });
    }

    /**
     * 采集平台和插件信息，并加入点击次数
     * @private
     */
    function _getPlatformInfo() {
        try {
            const plugins = Array.from(navigator.plugins).map(p => p.name).join(',');
            return { 
                platform: navigator.platform, 
                plugins: plugins, 
                touchPoints: navigator.maxTouchPoints || 0,
                clickCount: lastMousePosition.c 
            };
        } catch(e) {
            return 'err_platform';
        }
    }
    
    /**
     * 采集屏幕和语言信息
     * @private
     */
    function _getScreenAndLangInfo() {
        try {
            return {
                screen: `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`,
                language: navigator.language || navigator.userLanguage,
            };
        } catch (e) {
            return 'err_screen';
        }
    }

    /**
     * 采集更详细的性能信息，以应对缓存问题
     * @private
     */
    function _getPerformanceInfo() {
        try {
            if (!window.performance || typeof window.performance.getEntriesByType !== 'function') {
                return 'err_no_perf_api';
            }
            const navEntries = window.performance.getEntriesByType('navigation');
            if (!navEntries || navEntries.length === 0) {
                const t = window.performance.timing;
                if (!t) return 'err_no_timing';
                return { type: 'legacy', transferSize: -1, loadTime: t.loadEventEnd - t.navigationStart };
            }
            const nav = navEntries[0];
            return {
                type: nav.type,
                transferSize: nav.transferSize,
                loadTime: nav.duration,
            };
        } catch (e) {
            return 'err_perf';
        }
    }

    /**
     * 采集并分析鼠标轨迹数据
     * @private
     */
    function _getMouseTrajectory() {
        const capturedTrajectory = [...mouseTrajectory];
        mouseTrajectory.length = 0;
        return {
            points: capturedTrajectory,
            analysis: _analyzeMouseTrajectory(capturedTrajectory)
        };
    }

    // --- 公共接口 ---

    function startListeners() {
        document.addEventListener('mousemove', (e) => {
            if (Date.now() - lastMousePosition.t > 100) {
                lastMousePosition = { x: e.clientX, y: e.clientY, t: Date.now(), c: lastMousePosition.c };
                if (mouseTrajectory.length < 50) {
                    mouseTrajectory.push([e.clientX, e.clientY, Date.now()]);
                }
            }
        }, { passive: true });
        document.addEventListener('click', () => { lastMousePosition.c++; }, { passive: true });
    }

    async function gather(collectorsToRun) {
        const results = {};
        const collectorMap = {
            'canvas': _getCanvasFingerprint,
            'webgl': _getWebGLFingerprint,
            'audio': _getAudioFingerprint,
            'platform': _getPlatformInfo,
            'screen': _getScreenAndLangInfo,
            'performance': _getPerformanceInfo,
            'mouse_trajectory': _getMouseTrajectory,
            'anomaly_scan': HiveHyde.AnomalyScan.run,
        };
        const promises = [];
        const promiseKeys = [];
        for (const key of collectorsToRun) {
            if (collectorMap[key]) {
                promises.push(Promise.resolve(collectorMap[key]()));
                promiseKeys.push(key);
            }
        }
        const settledResults = await Promise.all(promises);
        for (let i = 0; i < promiseKeys.length; i++) {
            results[promiseKeys[i]] = settledResults[i];
        }
        return results;
    }

    HiveHyde.DataLoom = {
        gather,
        startListeners
    };

})(window);