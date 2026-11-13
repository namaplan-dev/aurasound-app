import { SmartPlaylist, Track } from '../types/music';
import { matchesNormalizedQuery } from '../utils/textNormalization';

export function evaluateSmartPlaylist(
  tracks: Track[],
  smart: SmartPlaylist
): Track[] {
  if (smart.pinnedTrackIds && smart.pinnedTrackIds.length > 0 && !smart.dynamicUpdate) {
    const map = new Map(tracks.map((t) => [t.id, t]));
    return smart.pinnedTrackIds
      .map((id) => map.get(id))
      .filter((t): t is Track => Boolean(t));
  }

  const ruleMatches = tracks.filter((track) => {
    if (smart.rules.length === 0) {
      return smart.pinnedTrackIds?.includes(track.id) ?? false;
    }
    return smart.rules.every((rule) => {
      switch (rule.field) {
        case 'genre':
          return matchesNormalizedQuery([track.genre], String(rule.value));
        case 'format':
          return track.format.toLowerCase() === String(rule.value).toLowerCase();
        case 'minRating':
          return track.rating >= Number(rule.value || 0);
        case 'favorite':
          return Boolean(track.favorite) === Boolean(rule.value);
        case 'minPlayCount':
          return track.playCount >= Number(rule.value || 0);
        case 'minSampleRate':
          return track.sampleRate >= Number(rule.value || 0);
        case 'moodKeyword':
          return matchesNormalizedQuery(
            [track.title, track.artist, track.album, track.genre],
            String(rule.value)
          );
        default:
          return true;
      }
    });
  });

  if (smart.pinnedTrackIds && smart.pinnedTrackIds.length > 0) {
    const seen = new Set(ruleMatches.map((t) => t.id));
    const extras = tracks.filter((t) => smart.pinnedTrackIds!.includes(t.id) && !seen.has(t.id));
    return [...extras, ...ruleMatches];
  }

  return ruleMatches;
}
