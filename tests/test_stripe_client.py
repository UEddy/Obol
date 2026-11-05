import httpx
import pytest

from obol_lib.stripe_client import StripeClient, StripeError, encode_form, key_mode


def test_key_mode():
    assert key_mode(None) == "missing"
    assert key_mode("") == "missing"
    assert key_mode("sk_test_abc") == "test"
    assert key_mode("rk_live_abc") == "live"
    assert key_mode("pk_test_abc") == "invalid"


@pytest.mark.parametrize("key,kind", [(None, "not_configured"), ("pk_test_x", "not_configured"),
                                      ("sk_live_x", "live_blocked")])
def test_client_refuses_bad_keys(key, kind):
    with pytest.raises(StripeError) as exc:
        StripeClient(key)
    assert exc.value.kind == kind


def test_live_key_allowed_only_when_opted_in():
    c = StripeClient("sk_live_x", allow_live=True)
    assert c.mode == "live"
    c.close()


def test_encode_form_nested():
    pairs = encode_form({"a": 1, "metadata": {"k": "v"}, "flag": False, "skip": None, "expand": ["x", "y"]})
    assert ("a", "1") in pairs and ("metadata[k]", "v") in pairs and ("flag", "false") in pairs
    assert ("expand[]", "x") in pairs and all(k != "skip" for k, _ in pairs)


def test_headers_and_idempotency(fake, client):
    seen = {}

    def capture(request):
        seen.update(request.headers)
        return httpx.Response(200, json={"id": "cus_1"})

    c = StripeClient("sk_test_1", transport=httpx.MockTransport(capture))
    c.request("POST", "/v1/customers", data={"email": "a@b.co"}, idempotency_key="k1")
    assert seen["idempotency-key"] == "k1"
    assert seen["stripe-version"] == "2024-06-20"
    assert seen["authorization"] == "Bearer sk_test_1"


def test_retries_5xx_with_same_idempotency_key(fake, client):
    fake.fail_queue.append(("/v1/customers", 503))
    cus = client.create_customer(email="a@b.co", name="A", idempotency_key="same")
    assert cus["email"] == "a@b.co"
    assert len(fake.customers) == 1
    # Replaying the same key returns the stored object, no second customer.
    again = client.create_customer(email="a@b.co", name="A", idempotency_key="same")
    assert again["id"] == cus["id"] and len(fake.customers) == 1


def test_timeout_retry_then_give_up(fake, client):
    fake.timeout_queue.extend(["/v1/invoices/in_x"] * 3)
    with pytest.raises(StripeError) as exc:
        client.get_invoice("in_x")
    assert exc.value.kind == "timeout"


def test_timeout_then_success(fake, client):
    fake.timeout_queue.append("/v1/customers")
    assert client.find_customer_by_email("nobody@x.co") is None


def test_error_mapping(fake, client):
    with pytest.raises(StripeError) as exc:
        client.get_invoice("in_missing")
    assert exc.value.kind == "not_found" and exc.value.status == 404 and "No such invoice" in str(exc.value)
    bad = StripeClient("sk_test_wrong_but_wellformed", transport=httpx.MockTransport(
        lambda r: httpx.Response(401, json={"error": {"message": "Invalid API Key"}})))
    with pytest.raises(StripeError) as exc:
        bad.get_invoice("in_1")
    assert exc.value.kind == "auth"


def test_non_json_error_body():
    c = StripeClient("sk_test_1", max_retries=0, transport=httpx.MockTransport(
        lambda r: httpx.Response(502, text="<html>bad gateway</html>")))
    with pytest.raises(StripeError) as exc:
        c.get_invoice("in_1")
    assert exc.value.status == 502
