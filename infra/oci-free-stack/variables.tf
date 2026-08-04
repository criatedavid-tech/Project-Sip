variable "tenancy_ocid" {
  description = "Preenchido automaticamente pelo OCI Resource Manager."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartimento em que os recursos serao criados."
  type        = string
}

variable "region" {
  description = "Regiao home do Free Tier."
  type        = string

  validation {
    condition     = var.region == "sa-saopaulo-1"
    error_message = "Esta pilha foi travada em sa-saopaulo-1 para usar a regiao home da conta."
  }
}

variable "ssh_public_key" {
  description = "Conteudo da chave SSH PUBLICA (.pub). Nunca informe a chave privada."
  type        = string
}

variable "admin_cidr" {
  description = "IPv4 publico do administrador em CIDR para liberar SSH, por exemplo 203.0.113.10/32."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "Informe um CIDR especifico. SSH aberto para 0.0.0.0/0 nao e permitido por esta pilha."
  }
}

variable "directcall_sip_source_ips" {
  description = "IPs SIP informados pela DirectCall."
  type        = list(string)
  default = [
    "189.84.133.111",
    "189.84.133.135",
    "189.84.133.169",
    "189.84.129.12"
  ]
}
