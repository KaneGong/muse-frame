"""Use the bundled certificate store on machines without the build Python."""

import os
import sys
from pathlib import Path

os.environ.setdefault("SSL_CERT_FILE", str(Path(sys._MEIPASS) / "certifi" / "cacert.pem"))
