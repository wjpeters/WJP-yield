# Watchlistbeheer — 29 september 2026

## Gedrag

- Zichtbare knop Beheer naast de watchlisttitel.
- Watchlists kiezen, aanmaken en hernoemen; alle vermeldingen bekijken en verwijderen.
- Iedere rij heeft een eigen, altijd zichtbare verwijderknop met toegankelijke naam.
- Een bevestiging noemt de watchlist of vermelding die wordt verwijderd.
- Verwijdering is beperkt tot de gekozen lijst. Eigen instrumenten worden pas uit de
  instrumentopslag verwijderd als geen enkele watchlist ze meer gebruikt.
- De standaard zoekcatalogus en bestaande tekeningen blijven onafhankelijk van watchlists.
- Ook de laatste lijst kan worden verwijderd. Een lege toestand biedt Watchlist maken.
- Na verwijderen van het gekozen instrument volgt een ander instrument uit dezelfde lijst,
  of een lege grafiek. Na verwijderen van de actieve lijst volgt een resterende lijst.
- Cleanup van watchlist en eigen instrumenten gebeurt in één databasetransactie.
- Bij opruiming verdwijnen actieve aanvragen, cache en instrumentmeldingen voor ongedeelde
  vermeldingen. Verlate koersen kunnen verwijderde eigen instrumenten niet opnieuw invoegen.

## Verificatie

- Productiebouw en 44 tests geslaagd. Vijf nieuwe integratietests met tijdelijke SQLite-opslag:
  gedeelde instrumenten, unieke instrumenten, losse vermeldingen, de laatste lijst,
  heropenen van opslag, onbekende doelen en de bestaande volledige update-route.
- Browserproeven in een afzonderlijke tijdelijke Docker-container op poort 4311, zonder
  gebruikerssleutels of persoonlijke watchlists: annuleren, geselecteerde vermelding verwijderen,
  automatische grafiekselectie, lijst aanmaken, hernoemen, actieve lijst verwijderen,
  laatste lijst verwijderen en opnieuw een lijst met een instrument maken.
- Desktop 1280×720 en mobiel 390×844 gecontroleerd; beheeracties zichtbaar, geen horizontale overflow.
- Geen browserconsolefouten tijdens de proef.
