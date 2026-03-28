{{/*
Expand the name of the chart.
*/}}
{{- define "opencode.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "opencode.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "opencode.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "opencode.labels" -}}
helm.sh/chart: {{ include "opencode.chart" . }}
{{ include "opencode.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "opencode.selectorLabels" -}}
app.kubernetes.io/name: {{ include "opencode.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image
*/}}
{{- define "opencode.image" -}}
{{- $image := .Values.image.imageOverrides.repository -}}
{{- if not $image -}}
{{- $image = printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}
{{- $image -}}
{{- end -}}

{{/*
Service account name
*/}}
{{- define "opencode.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- include "opencode.fullname" . -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
