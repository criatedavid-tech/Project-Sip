output "instance_id" {
  description = "OCID da instancia criada."
  value       = oci_core_instance.project_sip.id
}

output "public_ip" {
  description = "IPv4 publico usado para SSH, aplicacao e telefonia."
  value       = oci_core_instance.project_sip.public_ip
}

output "ssh_command" {
  description = "Modelo de comando para conectar. Ajuste o caminho da chave privada no Windows."
  value       = "ssh -i CAMINHO_DA_CHAVE_PRIVADA ubuntu@${oci_core_instance.project_sip.public_ip}"
}
