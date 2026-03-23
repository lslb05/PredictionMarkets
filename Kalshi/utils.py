import time
import base64
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

class KalshiAuth:
    def __init__(self, key_id: str, private_key_path: str):
        self.key_id = key_id
        self.private_key = self._load_private_key(private_key_path)

    def _load_private_key(self, path: str):
        with open(path, "rb") as key_file:
            return serialization.load_pem_private_key(
                    key_file.read(),
                    password=None,
                    backend=default_backend())

    def get_headers(self, method: str, path: str) -> dict:
        timestamp_str = str(int(time.time() * 1000))
        path_clean = path.split('?')[0]
        msg_string = timestamp_str + method + path_clean
        msg_bytes = msg_string.encode('utf-8')
        signature = self.private_key.sign(
            msg_bytes,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH  
            ),
            hashes.SHA256())
        
        sig_b64 = base64.b64encode(signature).decode('utf-8')
      
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-SIGNATURE": sig_b64,
            "KALSHI-ACCESS-TIMESTAMP": timestamp_str,
            "Content-Type": "application/json"}
    
