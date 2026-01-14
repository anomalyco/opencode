from urllib.parse import urlparse, urlunparse


def clean_amazon_url(url: str) -> str | None:
    """
    Clean Amazon product URLs by:
    - Keeping scheme, domain, and full product path
    - Removing query parameters
    - Removing fragments

    Matches browser 'Copy clean link' behavior.
    """
    parsed = urlparse(url)

    if "amazon." not in parsed.netloc.lower():
        return None

    # Rebuild URL without query and fragment
    cleaned_url = urlunparse((
        parsed.scheme or "https",
        parsed.netloc,
        parsed.path,
        "",   # params (rarely used)
        "",   # query removed
        ""    # fragment removed
    ))

    return cleaned_url
