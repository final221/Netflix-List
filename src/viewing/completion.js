export const completionRatio = 0.90;

export function createCompletion() {
    function titleType(record) {
        if (record?.type === 'movie') return 'movie';
        if (['show', 'series', 'tvshow', 'episode'].includes(record?.type)) return 'series';
        return undefined;
    }
    function classifyViewingVideo(record) {
        if (!record || !['movie', 'episode'].includes(record.type)) return 'unknown';
        if (record.watched === true) return 'complete';
        // Stopping at the credits can leave Netflix's flag false. Accept enough
        // playback independently of that flag, with a small allowance for credits.
        if (record.runtime > 0 && record.bookmark !== null) {
            const creditsBoundary = record.creditsOffset > 0 && record.creditsOffset <= record.runtime
                ? record.creditsOffset : record.runtime;
            const boundary = Math.min(creditsBoundary, record.runtime * completionRatio);
            if (record.bookmark >= boundary) return 'complete';
        }
        if (record.bookmark > 0) return 'in-progress';
        if (record.watched === false && record.bookmark === 0) return 'not-started';
        return 'unknown';
    }

    function classifyViewingSeries(plan) {
        if (!plan) return 'unknown';
        const ids = new Set();
        const statuses = [];
        for (const season of plan.seasons) {
            for (let index = 0; index < season.count; index++) {
                const episode = season.episodes.get(index);
                if (!episode?.id || ids.has(episode.id) || episode.status === 'unknown') return 'unknown';
                ids.add(episode.id);
                statuses.push(episode.status);
            }
        }
        if (statuses.length !== plan.expected || !statuses.length) return 'unknown';
        if (statuses.every(status => status === 'complete')) return 'complete';
        return statuses.every(status => status === 'not-started') ? 'not-started' : 'in-progress';
    }

    function viewingLatestEpisode(plan) {
        for (let seasonIndex = plan.seasons.length - 1; seasonIndex >= 0; seasonIndex--) {
            const season = plan.seasons[seasonIndex];
            if (season.count > 0) return { season, seasonNumber: seasonIndex + 1, index: season.count - 1,
                episode: season.episodes.get(season.count - 1) };
        }
        return null;
    }

    function viewingProgressSummary(record) {
        const status = classifyViewingVideo(record);
        const percent = record?.runtime > 0 && record.bookmark !== null
            ? Math.round(Math.min(100, record.bookmark / record.runtime * 100) * 10) / 10 : null;
        const creditsReached = Boolean(record?.runtime > 0 && record.creditsOffset > 0 &&
            record.creditsOffset <= record.runtime && record.bookmark !== null && record.bookmark >= record.creditsOffset);
        return { status, percent, thresholdPercent: completionRatio * 100,
            watched: typeof record?.watched === 'boolean' ? record.watched : null, creditsReached,
            reason: status === 'complete' ? record.watched === true ? 'watched-flag'
                : creditsReached ? 'credits-reached' : 'completion-threshold'
                : percent === null ? 'progress-unavailable' : 'below-completion-threshold' };
    }

    function viewingSeriesResult(plan) {
        const latest = viewingLatestEpisode(plan)?.episode;
        const ids = plan.seasons.flatMap(season => [...season.episodes.values()]).filter(episode => episode.id).map(episode => episode.id);
        // The user selected this inference even when older progress is absent or
        // reset. A validated season plan identifies the latest returned episode.
        if (latest?.id && latest.status === 'complete' && new Set(ids).size === ids.length) return 'complete';
        return classifyViewingSeries(plan);
    }
    return Object.freeze({ recordType: titleType, classifyVideo: classifyViewingVideo, classifySeries: classifyViewingSeries,
        latestEpisode: viewingLatestEpisode, progress: viewingProgressSummary, seriesResult: viewingSeriesResult });
}
