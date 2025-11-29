import merge from 'lodash.merge';

import type { MetaData } from '~/types';

export type Config = {
  site?: SiteConfig;
  metadata?: MetaDataConfig;
  i18n?: I18NConfig;
  apps?: {
    blog?: AppBlogConfig;
  };
  ui?: unknown;
  analytics?: unknown;
};

export interface SiteConfig {
  name: string;
  site?: string;
  base?: string;
  trailingSlash?: boolean;
  googleSiteVerificationId?: string;
}
export interface MetaDataConfig extends Omit<MetaData, 'title'> {
  title?: {
    default: string;
    template: string;
  };
}
export interface I18NConfig {
  language: string;
  textDirection: string;
  dateFormatter?: Intl.DateTimeFormat;
}
export interface AppBlogConfig {
  isEnabled: boolean;
  postsPerPage: number;
  isRelatedPostsEnabled: boolean;
  relatedPostsCount: number;
  post: {
    isEnabled: boolean;
    permalink: string;
    robots: {
      index: boolean;
      follow: boolean;
    };
  };
  list: {
    isEnabled: boolean;
    pathname: string;
    robots: {
      index: boolean;
      follow: boolean;
    };
  };
  category: {
    isEnabled: boolean;
    pathname: string;
    robots: {
      index: boolean;
      follow: boolean;
    };
  };
  tag: {
    isEnabled: boolean;
    pathname: string;
    robots: {
      index: boolean;
      follow: boolean;
    };
  };
}
export interface AnalyticsConfig {
  vendors: {
    googleAnalytics: {
      id?: string;
      partytown?: boolean;
    };
  };
}

export interface UIConfig {
  theme: string;
}

const DEFAULT_SITE_NAME = 'Website';

const getSite = (config: Config) => {
  const _default = {
    name: DEFAULT_SITE_NAME,
    site: undefined,
    base: '/',
    trailingSlash: false,

    googleSiteVerificationId: '',
  };

  return merge({}, _default, config?.site ?? {}) as SiteConfig;
};

const getMetadata = (config: Config) => {
  const siteConfig = getSite(config);

  const _default = {
    title: {
      default: siteConfig?.name || DEFAULT_SITE_NAME,
      template: '%s',
    },
    description: '',
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      type: 'website',
    },
  };

  return merge({}, _default, config?.metadata ?? {}) as MetaDataConfig;
};

const getI18N = (config: Config) => {
  const _default = {
    language: 'en',
    textDirection: 'ltr',
  };

  const value = merge({}, _default, config?.i18n ?? {});

  return value as I18NConfig;
};

const getAppBlog = (config: Config) => {
  const _default = {
    isEnabled: false,
    postsPerPage: 6,
    isRelatedPostsEnabled: false,
    relatedPostsCount: 4,
    post: {
      isEnabled: true,
      permalink: '/blog/%slug%',
      robots: {
        index: true,
        follow: true,
      },
    },
    list: {
      isEnabled: true,
      pathname: 'blog',
      robots: {
        index: true,
        follow: true,
      },
    },
    category: {
      isEnabled: true,
      pathname: 'category',
      robots: {
        index: true,
        follow: true,
      },
    },
    tag: {
      isEnabled: true,
      pathname: 'tag',
      robots: {
        index: false,
        follow: true,
      },
    },
  };

  return merge({}, _default, config?.apps?.blog ?? {}) as AppBlogConfig;
};

const getUI = (config: Config) => {
  const _default = {
    theme: 'system',
  };

  return merge({}, _default, config?.ui ?? {});
};

const getAnalytics = (config: Config) => {
  const _default = {
    vendors: {
      googleAnalytics: {
        id: undefined,
        partytown: true,
      },
    },
  };

  return merge({}, _default, config?.analytics ?? {}) as AnalyticsConfig;
};

export default (config: Config) => ({
  SITE: getSite(config),
  I18N: getI18N(config),
  METADATA: getMetadata(config),
  APP_BLOG: getAppBlog(config),
  UI: getUI(config),
  ANALYTICS: getAnalytics(config),
});
