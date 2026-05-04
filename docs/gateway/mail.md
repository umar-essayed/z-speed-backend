
---------- Forwarded message ---------
From: Abdullah Ashraf Arafat Sharaf El Sayed <Abelsayed@aaib.com>
Date: Wed, Feb 18, 2026, 4:29 PM
Subject: E-Commerce Integration for #Cook Door
To: Mostafa Soliman <ceo@mostafasolimangroup.com>, manarabdelhalim138@gmail.com <manarabdelhalim138@gmail.com>
Cc: Click2Shop <Click2Shop@aaib.com>


Dear Sir,

Kindly find CyberSource Integration guide below:

Please make sure that your transaction type is sale to be sent for settlement

Integration Guide: https://apps.cybersource.com/library/documentation/dev_guides/Secure_Acceptance_Hosted_Checkout/Secure_Acceptance_Hosted_Checkout.pdf

Kindly find flex Microform for app integration below

https://developer.cybersource.com/content/dam/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex.pdf

Required signed fields

Note:  Please send in accurate data and avoid dummy values in Payer Authentication Enrollment calls to prevent any adverse impact on how your transactions are evaluated by issuers.
      

  Rest API Field

Simple Order/SOAP Field

SCMP Field

Secure Acceptance

Note

deviceInformation.ipAddress

billTo_ipAddress

customer_ipaddress

customer_ip_address

Mandatory for browser-based transactions only.
Collected during Device Data Collection (DDC) process
Besides collecting these 3 required browser fields, we recommend to collect the other 8 browser fields that are listed in Data Device Collection page as well to ensure the authentication is processed as an EMV 3DS transaction. 

deviceInformation.httpBrowserScreenHeight

billTo_httpBrowserScreenHeight

http_browser_screen_height

customer_browser_screen_height

deviceInformation.httpBrowserScreenWidth

 billTo_httpBrowserScreenWidth

http_browser_screen_width

customer_browser_screen_width

orderInformation.billTo.locality

billTo_city

bill_city

bill_to_address_city

These remain required for US., Canada and Mainland China, and recommended for other countries when processing through Cybersource Payer Authentication Enrollment service. 

orderInformation.billTo.country

billTo_country

bill_country

bill_to_address_country

orderInformation.billTo.postalCode

billTo_postalCode

bill_zip

bill_to_address_postal_code

orderInformation.billTo.administrativeArea

billTo_state

bill_state

bill_to_address_state

orderInformation.billTo.address1  

billTo_street1

bill_address1

bill_to_address_line1

These are existing mandatory fields in Payer Authentication services, please continue to send them in Payer Authentication Enrollment requests. 

orderInformation.billTo.email  

billTo_email

customer_email

bill_to_email

orderInformation.billTo.firstName

billTo_firstName

customer_firstname

bill_to_forename

orderInformation.billTo.lastName

billTo_lastName

customer_lastname

bill_to_surname

buyerInformation.workPhone

payerAuthEnrollService_workPhone

pa_work_phone

NIL

At least one of these fields must be present unless market or regional mandate restricts sending Cardholder Phone Number
 

orderInformation.billTo.phoneNumber

billTo_phoneNumber

customer_phone

bill_to_phone

buyerInformation.mobilePhone

payerAuthEnrollService_mobilePhone

pa_mobile_phone

payer_authentication_mobile_phone

Common Device Identification Parameters (Device IP Address) are applicable only to Software Development Kit (SDK) transactions, which are handled by the Cardinal SDK. 

 



Abdullah Ashraf Arafat
E-Commerce Gov. Business Manager
E-Commerce Business
Consumer Banking - Digital Channels
Direct: 01110896423 | Ext.: 5237
Address: AAIB Head Office - 5 ElSaraya ElKobra - Garden City
 Call me    |   Chat with me 

 

 

 

From: Mostafa Soliman <ceo@mostafasolimangroup.com>
Sent: Wednesday, February 18, 2026 4:16 PM
To: Abdullah Ashraf Arafat Sharaf El Sayed <Abelsayed@aaib.com>
Cc: Click2Shop <Click2Shop@aaib.com>
Subject:

 

[External Mail]

manarabdelhalim138@gmail.com

Caution: This email originated from outside of AAIB. Do not click on any links or open any untrusted attachments unless you validate the sender and know the content is safe.
If you felt that there is anything suspicious about this email, please forward it immediately to Information Security Team through information_security@aaib.com.