# Event Odds UI

## Design intent

The page combines prediction-market information density with Satstreet's restrained institutional terminal language. Probability is the dominant signal; the interface contains no trading actions, wallets, balances or venue branding.

## Page structure

Compact title and feed state; search; scrollable category filters; active-market, reported-volume and update statistics; supported sort control; responsive market grid; third-party disclosure.

## Market-card anatomy

Category and compact text icon, event question, leading outcome and probability, all remaining outcomes with proportional bars, reported volume, resolution date, optional seven-day probability move, source and update time. Exclusive and independent-outcome groups are explicitly distinguished.

## Filters and sorting

Search matches question, normalized category, source group and outcome labels. Categories include All, Bitcoin, Crypto, Fed, Rates, Inflation, AI, Politics, Geopolitics, Oil and Commodities. Categories absent from the current feed are disabled. Supported sorting is reported volume, highest leading probability and closing soon.

Trending, biggest move, recently added and 24-hour volume are not offered because the current feed does not provide reliable fields for them.

## Data and source behavior

The page preserves the existing same-origin `/api/forecasts` integration. No static market records are bundled. Missing values display as unavailable, and a failed request replaces the grid with a retryable professional error state. Current upstream attribution is displayed on every card.

## Disclaimer

Prediction-market probabilities are third-party market data. They do not represent Satstreet views, forecasts or investment recommendations. Satstreet does not operate the venue, verify outcomes, or provide prediction-market execution.

## Known limitations and future improvements

The current endpoint exposes reported total volume rather than 24-hour volume and provides no stable trending or recently-added signal. Future API additions could support those controls, richer resolution rules and an expandable detail panel without introducing execution functionality.
