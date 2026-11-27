const X=require('xlsx');
module.exports=function fixture(period='2026-12-01'){
 const month=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][Number(period.slice(5,7))-1],label=month+' '+period.slice(0,4);
 const pay=Array.from({length:10},()=>[]);pay[4][4]=label;pay[6][5]='Nome Completo';pay[6][59]='Total';pay[7][17]='Vencimento Base';pay[7][27]='Comissão vendedor';pay[7][36]='Comissão chefe';
 Object.assign(pay[8],{4:100000010,5:'Chefe teste',6:'Chefe_Equipa',7:'Equipa teste',8:'Coord Teste',13:'TAB_CHEE',17:9,36:1,59:10});
 Object.assign(pay[9],{4:100000001,5:'Comercial teste',6:'Vendedor',7:'Equipa teste',8:'Coord Teste',13:'TAB_VDD',17:35,27:5,59:40});
 const detail=Array.from({length:7},()=>[]);detail[5][22]='VP';Object.assign(detail[6],{0:'COMISSOES',1:'OV-TESTE',2:'ITEM-TESTE',4:'Cliente fictício',5:'200000001',7:'TV',8:'Instalado',9:'Coord Teste',12:'Equipa teste',13:'Comercial teste',14:100000001,20:5,21:1,22:1.5});
 const payBook=X.utils.book_new(),detailBook=X.utils.book_new();X.utils.book_append_sheet(payBook,X.utils.aoa_to_sheet(pay),'Pagamento');
 const production=[['Comercial teste',100000001,'Equipa teste','Coord Teste']];production[0][16]='#NAME?';X.utils.book_append_sheet(payBook,X.utils.aoa_to_sheet(production),'Resumo Produção_Vdd');
 X.utils.book_append_sheet(detailBook,X.utils.aoa_to_sheet(detail),'Detalhe de Variáveis');X.utils.book_append_sheet(detailBook,X.utils.aoa_to_sheet([['Descrição']]),'Acertos Diversos');
 return {payBook,detailBook,payName:'PAGAMENTOS_'+label.toUpperCase()+'_TESTE.xlsx',detailName:'DETALHES PAGAMENTO_'+label.toUpperCase()+'_TESTE.xlsx',period,coordinator:'Coord Teste'};
};
