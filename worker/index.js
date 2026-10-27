/**
 * The scam-alert sign-up route (TASK-108, ADL-213 §3.2).
 *
 * The only server-side code on getquiet.co.uk. Handles POST
 * /scam-alerts/signup from the form on /scam-alerts.html and creates the
 * contact as pending in EmailOctopus (double opt-in sends the confirmation
 * email; nothing else is sent until the person confirms). Every other
 * request falls through to the static assets.
 *
 * Privacy invariants (ADL-213 §3.2, record of processing B7):
 *  - No log line ever carries an email address or a provider answer.
 *    Observability is on for this Worker, so nothing dynamic is logged
 *    except upstream HTTP status codes.
 *  - An address already on the list (EmailOctopus 409) and a filled-in
 *    honeypot both get the same answer as a fresh sign-up, so the form
 *    cannot be used to test whether an address is subscribed and a bot
 *    learns nothing. The honeypot creates no contact.
 *
 * Works with JavaScript off: success is a 303 redirect to the
 * check-your-email page; a failure returns the sign-up page itself with
 * the error injected server-side (HTMLRewriter) and the email re-filled.
 *
 * Bindings (wrangler.jsonc): ASSETS (static assets), SIGNUP_RATE_LIMITER
 * (10 submissions a minute per IP), EMAILOCTOPUS_LIST_ID (plain var),
 * EMAILOCTOPUS_API_KEY (Worker secret, never in the repository).
 */

const SIGNUP_PATH = "/scam-alerts/signup";
const SIGNUP_PAGE = "/scam-alerts.html";
const CHECK_EMAIL_PAGE = "/scam-alerts-check-your-email.html";
const WORDING_VERSION_TAG = "signup-form-v1";

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
      return redirect(url, SIGNUP_PAGE);
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
      return redirect(url, CHECK_EMAIL_PAGE);
    }

    if (!consentTicked) {
      return errorPage(request, env, ERRORS.boxNotTicked, 400, { email });
    }

    if (!isPlausibleEmail(email)) {
      return errorPage(request, env, ERRORS.badAddress, 400, { email });
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
      return redirect(url, CHECK_EMAIL_PAGE);
    }

    console.error(`signup: EmailOctopus returned ${response.status}`);
    return errorPage(request, env, ERRORS.ourFault, 500, { email, consentTicked });
  },
};

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
