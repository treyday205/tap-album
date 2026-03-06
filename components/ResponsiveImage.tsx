import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../services/api';
import { isAssetRef } from '../services/assets';

type ResponsiveImageProps = {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low' | 'auto';
  assetRef?: string | null;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  onError?: React.ReactEventHandler<HTMLImageElement>;
};

const DEFAULT_WIDTHS = [320, 480, 640, 800, 1024, 1280];
const IMAGE_RESIZE_PATH = '/api/images/resize';

const isInlineImage = (value: string) =>
  value.startsWith('data:') || value.startsWith('blob:');

let resizeEndpointAvailability: 'unknown' | 'available' | 'unavailable' = 'unknown';
let resizeEndpointProbe: Promise<boolean> | null = null;

const probeResizeEndpointAvailability = async () => {
  if (resizeEndpointAvailability === 'available') return true;
  if (resizeEndpointAvailability === 'unavailable') return false;
  if (resizeEndpointProbe) return resizeEndpointProbe;

  const base = API_BASE_URL || '';
  resizeEndpointProbe = fetch(`${base}${IMAGE_RESIZE_PATH}`, {
    method: 'GET',
    credentials: 'include'
  })
    .then((response) => {
      const available = response.status === 400;
      resizeEndpointAvailability = available ? 'available' : 'unavailable';
      return available;
    })
    .catch(() => {
      resizeEndpointAvailability = 'unavailable';
      return false;
    })
    .finally(() => {
      resizeEndpointProbe = null;
    });

  return resizeEndpointProbe;
};

const buildProxyUrl = (
  source: { ref?: string | null; url?: string | null },
  width: number,
  format?: string
) => {
  const params = new URLSearchParams();
  if (source.ref) {
    params.set('ref', source.ref);
  } else if (source.url) {
    params.set('url', source.url);
  }
  params.set('w', String(width));
  params.set('q', '78');
  if (format) {
    params.set('format', format);
  }
  const base = API_BASE_URL || '';
  return `${base}${IMAGE_RESIZE_PATH}?${params.toString()}`;
};

const ResponsiveImage: React.FC<ResponsiveImageProps> = ({
  src,
  alt,
  className,
  sizes,
  width,
  height,
  loading = 'lazy',
  fetchPriority = 'auto',
  assetRef,
  onLoad,
  onError
}) => {
  const normalizedSrc = String(src || '').trim();
  if (!normalizedSrc) {
    return null;
  }
  const resolvedSizes = sizes || '100vw';

  const shouldProxy = !isInlineImage(normalizedSrc);
  const [useProxy, setUseProxy] = useState(
    () => shouldProxy && resizeEndpointAvailability !== 'unavailable'
  );

  useEffect(() => {
    setUseProxy(shouldProxy && resizeEndpointAvailability !== 'unavailable');
  }, [assetRef, normalizedSrc, shouldProxy]);

  useEffect(() => {
    if (!shouldProxy || !useProxy || resizeEndpointAvailability !== 'unknown') return;

    let cancelled = false;
    void probeResizeEndpointAvailability().then((available) => {
      if (!cancelled && !available) {
        setUseProxy(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [shouldProxy, useProxy]);

  const source = useMemo(() => {
    if (!shouldProxy) return { url: normalizedSrc };
    const ref = isAssetRef(assetRef || '') ? String(assetRef) : null;
    return { ref, url: ref ? null : normalizedSrc };
  }, [assetRef, normalizedSrc, shouldProxy]);

  const webpSrcSet = useMemo(
    () => DEFAULT_WIDTHS.map((w) => `${buildProxyUrl(source, w, 'webp')} ${w}w`).join(', '),
    [source]
  );
  const fallbackSrcSet = useMemo(
    () => DEFAULT_WIDTHS.map((w) => `${buildProxyUrl(source, w, 'jpeg')} ${w}w`).join(', '),
    [source]
  );
  const fallbackSrc = useMemo(
    () => buildProxyUrl(source, DEFAULT_WIDTHS[1], 'jpeg'),
    [source]
  );

  if (!shouldProxy || !useProxy) {
    return (
      <img
        src={normalizedSrc}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        width={width}
        height={height}
        onLoad={onLoad}
        onError={onError}
      />
    );
  }

  return (
    <picture>
      <source type="image/webp" srcSet={webpSrcSet} sizes={resolvedSizes} />
      <img
        src={fallbackSrc}
        srcSet={fallbackSrcSet}
        sizes={resolvedSizes}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
        width={width}
        height={height}
        onLoad={onLoad}
        onError={() => {
          setUseProxy(false);
          if (resizeEndpointAvailability === 'unknown') {
            void probeResizeEndpointAvailability();
          }
        }}
      />
    </picture>
  );
};

export default ResponsiveImage;
