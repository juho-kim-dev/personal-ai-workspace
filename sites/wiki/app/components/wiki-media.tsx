'use client';

import { parseWikiMedia, type WikiYouTubeMacro } from '../../lib/wiki-media';
import './wiki-media.css';

/** Accept source, not an iframe URL or markup; invalid input stays escaped text. */
export function WikiMedia({ source }: { source: string }) {
    const media = parseWikiMedia(source);
    if (!media) return <>{source}</>;
    return <WikiYouTubePlayer key={JSON.stringify(media)} media={media} />;
}

function WikiYouTubePlayer({ media }: { media: WikiYouTubeMacro }) {
    const parameters = new URLSearchParams({ autoplay: '0' });
    if (media.start > 0) parameters.set('start', String(media.start));
    if (media.end !== null) parameters.set('end', String(media.end));
    const embedUrl = `https://www.youtube-nocookie.com/embed/${media.videoId}?${parameters}`;
    return <div className="wiki-media" data-align={media.align ?? 'left'} style={{ width: media.width, maxWidth: '100%' }}>
        <div className="wiki-media-frame" style={{ aspectRatio: media.aspectRatio }}>
            <iframe
                src={embedUrl}
                title={`YouTube 영상 (${media.videoId})`}
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="fullscreen; presentation"
                allowFullScreen
            />
        </div>
    </div>;
}
