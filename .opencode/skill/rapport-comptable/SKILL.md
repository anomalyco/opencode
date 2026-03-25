---
name: rapport-comptable
description: Use when generating, formatting, or discussing French accounting reports (bilan, compte de résultat, trésorerie, TVA, grand livre, balance, créances, dettes, rapprochement bancaire). Provides business logic per report category and French accounting conventions.
---

## Use this when

- L'utilisateur demande un rapport comptable via `/rapport`
- L'utilisateur parle de bilan, P&L, TVA, trésorerie, ou tout document comptable
- L'utilisateur travaille avec des données Pennylane ou des exports Excel comptables

## Plan Comptable Général (PCG) — Classes principales

| Classe | Libellé | Usage rapport |
|--------|---------|---------------|
| 1 | Comptes de capitaux | Bilan (passif) |
| 2 | Comptes d'immobilisations | Bilan (actif immobilisé) |
| 3 | Comptes de stocks | Bilan (actif circulant) |
| 4 | Comptes de tiers | Créances / Dettes |
| 5 | Comptes financiers | Trésorerie, rapprochement |
| 6 | Comptes de charges | Compte de résultat |
| 7 | Comptes de produits | Compte de résultat |

## Logique métier par rapport

### Bilan
- **Actif** : classes 2 (immobilisations nettes d'amortissements) + 3 (stocks) + 4 débiteurs + 5 (trésorerie positive)
- **Passif** : classe 1 (capitaux, résultat) + 4 créditeurs + 5 (découverts)
- **Contrôle** : Total Actif = Total Passif — toute différence est une erreur

### Compte de résultat
- **Produits** : classe 7 (ventes, production, produits financiers, produits exceptionnels)
- **Charges** : classe 6 (achats, services, personnel, impôts, dotations, charges financières, charges exceptionnelles)
- **Résultat net** = Total produits - Total charges
- Présenter par nature (par défaut) ou par fonction (si demandé)

### TVA
- **Collectée** : comptes 4457x, ventilée par taux (20%, 10%, 5.5%, 2.1%)
- **Déductible** : comptes 4456x (immobilisations 44562, biens & services 44566)
- **À payer** = Collectée - Déductible (si positif) / **Crédit** (si négatif)
- Période : mensuelle ou trimestrielle selon régime

### Créances / Dettes
- Comptes 411x (clients) pour créances, 401x (fournisseurs) pour dettes
- Classement par ancienneté depuis date de facture
- Alerter sur les montants échus > 90 jours

### Rapprochement bancaire
- Comparer solde compte 512x avec relevé bancaire
- Lister opérations non rapprochées des deux côtés
- Écart = erreur ou opérations en transit

## Formatage français

- Montants : `1 234,56 €` (espace milliers, virgule décimale)
- Dates : `JJ/MM/AAAA`
- Périodes : `Janvier 2025`, `T1 2025`, `Exercice 2024`
- Nombres négatifs entre parenthèses : `(1 234,56)`

## Adaptations par secteur

L'expert-comptable précise le secteur. Adaptations courantes :
- **SaaS / Tech** : MRR, ARR, churn dans le commentaire de gestion
- **Commerce** : marge brute détaillée, rotation des stocks
- **BTP** : avancement des chantiers, provisions pour risques
- **Professions libérales** : recettes/dépenses (BNC), pas de bilan complet
- **Restauration** : ratio matières premières, coût du personnel

En cas de doute sur le secteur, demander à l'utilisateur.
