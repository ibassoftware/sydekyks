"""Tenant reporting-currency validation (no DB)."""

import pytest
from pydantic import ValidationError

from app.routers.tenant import SUPPORTED_CURRENCIES, TenantSettingsUpdate


def test_currency_normalized_uppercase():
    assert TenantSettingsUpdate(currency="php").currency == "PHP"
    assert TenantSettingsUpdate(currency="Usd").currency == "USD"


def test_currency_rejects_non_iso():
    for bad in ["US", "DOLLAR", "12A", "$$$", ""]:
        with pytest.raises(ValidationError):
            TenantSettingsUpdate(currency=bad)


def test_supported_currencies_are_valid_codes():
    assert "USD" in SUPPORTED_CURRENCIES and "PHP" in SUPPORTED_CURRENCIES
    assert all(len(c) == 3 and c.isalpha() and c.isupper() for c in SUPPORTED_CURRENCIES)
