"""PyInstaller runtime hook: fix certifi.where() in frozen builds."""
import os
import sys

if getattr(sys, "frozen", False):
    # In a PyInstaller bundle, certifi's cacert.pem is extracted alongside
    # the certifi package directory. Point SSL_CERT_FILE so that urllib3
    # and requests can find it even if certifi.where() fails.
    _cacert = os.path.join(sys._MEIPASS, "certifi", "cacert.pem")
    if os.path.isfile(_cacert):
        os.environ.setdefault("SSL_CERT_FILE", _cacert)
        os.environ.setdefault("REQUESTS_CA_BUNDLE", _cacert)
