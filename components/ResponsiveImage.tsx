import React, { useMemo, useState } from 'react';
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

const isInlineImage = (value: string) =>
  value.startsWith('data:') || value.startsWith('blob:');

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
  return `${base}/api/images/resize?${params.toString()}`;
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
  const [useProxy, setUseProxy] = useState(true);
  const source = useMemo(() => {
    if (!shouldProxy) return { url: normalizedSrc };
    const ref = isAssetRef(assetRef || '') ? String(assetRef) : null;
    return { ref, url: ref ? null : normalizedSrc };
  }, [assetRef, normalizedSrc, shouldProxy]);

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

  const webpSrcSet = useMemo(
    () => DEFAULT_WIDTHS.map((w) => `${buildProxyUrl(source, w, 'webp')} ${w}w`).join(', '),
    [source]
  );
  const fallbackSrcSet = useMemo(
    () => DEFAULT_WIDTHS.map((w) => `${buildProxyUrl(source, w, 'jpeg')} ${w}w`).join(', '),
    [source]
  );
  const fallbackSrc = buildProxyUrl(source, DEFAULT_WIDTHS[1], 'jpeg');

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
        onError={(event) => {
          setUseProxy(false);
          onError?.(event);
        }}
      />
    </picture>
  );
};

export default ResponsiveImage;
