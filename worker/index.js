/**
 * The scam-alert sign-up route (TASK-108, ADL-213 §3.2).
 *
 * The only server-side code on getquiet.co.uk. Handles POST
 * /scam-alerts/signup from the form on /scam-alerts.html and creates the
 * contact as pending in EmailOctopus (double opt-in sends the confirmation
 * email; nothing else is sent until the person confirms). Every other
 * request falls through to the static assets.
 *
 * Privacy invariants (ADL-213 §3.2 and §9, record of processing B5 and B7):
 *  - No log line ever carries an email address, a provider answer, a
 *    Turnstile token or an IP address. Observability is on for this
 *    Worker, so nothing dynamic is logged except upstream HTTP status
 *    codes and Cloudflare's own siteverify error codes (ADL-213 §9.3).
 *  - An address already on the list (EmailOctopus 409) and a filled-in
 *    honeypot both get the same answer as a fresh sign-up, so the form
 *    cannot be used to test whether an address is subscribed and a bot
 *    learns nothing. The honeypot creates no contact.
 *  - The bot check (ADL-213 §9.2): the Turnstile token is verified with
 *    Cloudflare's siteverify after the honeypot and before the consent
 *    and address checks, with one attempt and a 10 second timeout, and
 *    it fails closed. No call to EmailOctopus is made unless the check
 *    has passed with the expected hostname and action.
 *
 * JavaScript: error answers are still rendered server-side (HTMLRewriter)
 * with the email re-filled, and success is a 303 redirect to the
 * check-your-email page, but a successful sign-up now needs JavaScript
 * for the Turnstile widget (ADL-213 §9.5); the page says so.
 *
 * Bindings (wrangler.jsonc): ASSETS (static assets), SIGNUP_RATE_LIMITER
 * (10 submissions a minute per IP), EMAILOCTOPUS_LIST_ID,
 * TURNSTILE_EXPECTED_HOSTNAME and TURNSTILE_EXPECTED_ACTION (plain vars;
 * the expected values are vars because Cloudflare's dummy secrets answer
 * with hostname example.com and no action, so .dev.vars overrides both
 * for the local walk), EMAILOCTOPUS_API_KEY and TURNSTILE_SECRET_KEY
 * (Worker secrets, never in the repository).
 */

const SIGNUP_PATH = "/scam-alerts/signup";
const SIGNUP_PAGE = "/scam-alerts.html";
// Redirect targets use the extensionless canonical form, so the browser is
// not bounced through the asset router's 307 on the .html form.
const SIGNUP_REDIRECT = "/scam-alerts";
const CHECK_EMAIL_REDIRECT = "/scam-alerts-check-your-email";
const WORDING_VERSION_TAG = "signup-form-v1";

// The bot check (ADL-213 §9.2).
const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Siteverify error codes that mean the visitor's token was missing, bad or
// spent: these get the "couldn't check" answer. Any other failure (a secret
// error, bad-request, internal-error, an unknown code) is our side.
const TURNSTILE_VISITOR_ERROR_CODES = new Set([
  "missing-input-response",
  "invalid-input-response",
  "timeout-or-duplicate",
]);

// The provider question's stored values (copy spec §7.2, decision 548).
const PROVIDER_VALUES = new Set([
  "gmail",
  "microsoft",
  "yahoo_aol",
  "bt",
  "sky",
  "icloud",
  "other",
  "not_sure",
]);

// Error copy exactly as the copy spec §7.3 (decision 548): reader copy,
// typographic apostrophes, no dashes.
const ERRORS = {
  badAddress: "Please check your email address. It doesn’t look quite right.",
  boxNotTicked:
    "Please tick the box to say you’d like the email. We can’t sign you up without it.",
  tooManyTries: "Please wait a few minutes and try again.",
  checkFailed:
    "We couldn’t check that you’re a person. Please make sure JavaScript is turned on and try again. If it keeps happening, email hello@getquiet.co.uk.",
  ourFault:
    "Something went wrong on our side and we couldn’t sign you up. Please try again later, or email hello@getquiet.co.uk.",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only the sign-up route runs here (run_worker_first); anything else
    // that reaches the script is a request no asset matched.
    if (url.pathname !== SIGNUP_PATH) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return redirect(url, SIGNUP_REDIRECT);
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Rate limit per IP before any work (ADL-213 §3.2 bot defence).
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.SIGNUP_RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return errorPage(request, env, ERRORS.tooManyTries, 429, {});
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return errorPage(request, env, ERRORS.badAddress, 400, {});
    }

    const email = (form.get("email") ?? "").toString().trim();
    const provider = (form.get("provider") ?? "").toString();
    const consentTicked = form.get("consent") !== null;
    const honeypotFilled = ((form.get("website") ?? "").toString().trim()) !== "";

    // A filled-in honeypot creates nothing and answers like any other
    // submission (copy spec §2 and §7.3).
    if (honeypotFilled) {
      return redirect(url, CHECK_EMAIL_REDIRECT);
    }

    // The bot check (ADL-213 §9.2): after the honeypot, before the consent
    // and address checks. Fails closed; the error page carries a fresh
    // widget, so a person can simply try again.
    const token = (form.get("cf-turnstile-response") ?? "").toString();
    const check = await verifyTurnstileToken(token, env);
    if (check !== "passed") {
      return check === "failed"
        ? errorPage(request, env, ERRORS.checkFailed, 403, { email, consentTicked })
        : errorPage(request, env, ERRORS.ourFault, 500, { email, consentTicked });
    }

    if (!consentTicked) {
      return errorPage(request, env, ERRORS.boxNotTicked, 400, { email });
    }

    if (!isPlausibleEmail(email)) {
      return errorPage(request, env, ERRORS.badAddress, 400, { email, consentTicked });
    }

    const body = {
      email_address: email,
      // Double opt-in is on for the list; pending is stated explicitly so a
      // list-setting change can never make the API subscribe anyone unconfirmed
      // (ADL-213 §3.3).
      status: "pending",
      tags: [WORDING_VERSION_TAG],
    };
    if (PROVIDER_VALUES.has(provider)) {
      body.fields = { Provider: provider };
    }

    let response;
    try {
      response = await fetch(
        `https://api.emailoctopus.com/lists/${env.EMAILOCTOPUS_LIST_ID}/contacts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.EMAILOCTOPUS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      // Static marker only: never the address, never the provider answer.
      console.error("signup: EmailOctopus request failed to send");
      return errorPage(request, env, ERRORS.ourFault, 500, { email, consentTicked });
    }

    // 409 means the address is already on the list; it gets the same answer
    // as a fresh sign-up (copy spec §2).
    if (response.ok || response.status === 409) {
      return redirect(url, CHECK_EMAIL_REDIRECT);
    }

    console.error(`signup: EmailOctopus returned ${response.status}`);
    return errorPage(request, env, ERRORS.ourFault, 500, { email, consentTicked });
  },
};

/**
 * Verifies the form's Turnstile token with Cloudflare's siteverify
 * (ADL-213 §9.2): one attempt, a 10 second timeout, no remoteip. Returns
 * "passed", "failed" (the visitor's token was missing, bad, spent, or for
 * the wrong hostname or action: the "couldn't check" answer) or "ourFault"
 * (siteverify unreachable, timed out, malformed, or any other error: the
 * "our side" answer). Logs fixed text and Cloudflare's error codes only
 * (§9.3): never the token.
 */
async function verifyTurnstileToken(token, env) {
  // Siteverify caps tokens at 2048 characters; an empty or oversized one
  // cannot pass, so it is refused without a call.
  if (token === "" || token.length > 2048) {
    console.error("signup: turnstile token missing or malformed");
    return "failed";
  }

  let response;
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY ?? "",
        response: token,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("signup: turnstile siteverify unreachable or timed out");
    return "ourFault";
  }

  let data;
  try {
    data = await response.json();
  } catch {
    console.error("signup: turnstile siteverify answer malformed");
    return "ourFault";
  }

  if (data.success === true) {
    // Dummy-secret answers carry hostname example.com and no action, so
    // both expected values are plain vars overridden in .dev.vars.
    if (
      (data.hostname ?? "") === env.TURNSTILE_EXPECTED_HOSTNAME &&
      (data.action ?? "") === env.TURNSTILE_EXPECTED_ACTION
    ) {
      return "passed";
    }
    console.error("signup: turnstile hostname or action mismatch");
    return "failed";
  }

  const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
  console.error(`signup: turnstile check failed [${codes.join(",")}]`);
  return codes.some((code) => TURNSTILE_VISITOR_ERROR_CODES.has(code))
    ? "failed"
    : "ourFault";
}

/** 303 so the browser follows with a GET and a refresh never re-posts. */
function redirect(url, path) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, url).toString(),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * A pragmatic shape check, not RFC 5322: one @, something either side,
 * a dot in the domain, no spaces, sane length. EmailOctopus validates
 * properly on its side; its rejection comes back as "our fault".
 */
function isPlausibleEmail(email) {
  if (email.length < 6 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Returns the sign-up page itself with the error shown above the form and
 * the typed email re-filled, so the answer works with JavaScript off.
 * HTMLRewriter escapes both the text and the attribute value.
 */
async function errorPage(request, env, message, status, { email, consentTicked }) {
  const pageResponse = await env.ASSETS.fetch(
    new URL(SIGNUP_PAGE, request.url).toString(),
  );

  let rewriter = new HTMLRewriter().on("[data-form-error]", {
    element(el) {
      el.removeAttribute("hidden");
      el.setInnerContent(message);
    },
  });
  if (email) {
    rewriter = rewriter.on('input[name="email"]', {
      element(el) {
        el.setAttribute("value", email);
      },
    });
  }
  if (consentTicked) {
    rewriter = rewriter.on('input[name="consent"]', {
      element(el) {
        el.setAttribute("checked", "");
      },
    });
  }

  const rewritten = rewriter.transform(pageResponse);
  return new Response(rewritten.body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
